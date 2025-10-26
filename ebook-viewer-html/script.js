// Supabase Client - IMPORTANT: Replace with your project details
const SUPABASE_URL = 'YOUR_SUPABASE_URL'; // TODO: Replace with your Supabase URL
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY'; // TODO: Replace with your Supabase Anon Key
const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

console.log('Supabase client initialized. If you see errors, check your URL and Key.');

// PDF.js setup
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js';

// DOM Elements
const pdfCanvas = document.getElementById('pdf-canvas');
const drawingCanvas = document.getElementById('drawing-canvas');
const ctx = drawingCanvas.getContext('2d');
const prevPageBtn = document.getElementById('prev-page');
const nextPageBtn = document.getElementById('next-page');
const pageNumSpan = document.getElementById('page-num');
const pageCountSpan = document.getElementById('page-count');
const editModeBtn = document.getElementById('edit-mode-btn');
const saveBtn = document.getElementById('save-btn');

// Global state
const EBOOK_ID = 'sample-book'; // A unique ID for this book
let pdfDoc = null;
let pageNum = 1;
let pageCount = 0;
let isEditMode = false;
let isDrawing = false;
let currentPath = [];
let pageAnnotations = {}; // Store annotations for all pages { 1: [[path1], [path2]], 2: [...] }

// --- Drawing Functions ---
function startDrawing(e) {
    isDrawing = true;
    const pos = getMousePos(drawingCanvas, e);
    currentPath = [{ x: pos.x, y: pos.y }];
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
}

function draw(e) {
    if (!isDrawing) return;
    const pos = getMousePos(drawingCanvas, e);
    currentPath.push({ x: pos.x, y: pos.y });
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
}

function stopDrawing() {
    if (!isDrawing) return;
    isDrawing = false;
    if (!pageAnnotations[pageNum]) {
        pageAnnotations[pageNum] = [];
    }
    pageAnnotations[pageNum].push(currentPath);
    currentPath = [];
}

function getMousePos(canvas, evt) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: evt.clientX - rect.left,
        y: evt.clientY - rect.top
    };
}

function toggleEditMode() {
    isEditMode = !isEditMode;
    if (isEditMode) {
        editModeBtn.textContent = '편집 종료';
        drawingCanvas.style.pointerEvents = 'auto';
        drawingCanvas.addEventListener('mousedown', startDrawing);
        drawingCanvas.addEventListener('mousemove', draw);
        drawingCanvas.addEventListener('mouseup', stopDrawing);
        drawingCanvas.addEventListener('mouseout', stopDrawing);
        ctx.strokeStyle = 'red';
        ctx.lineWidth = 2;
    } else {
        editModeBtn.textContent = '펜 사용하기';
        drawingCanvas.style.pointerEvents = 'none';
        drawingCanvas.removeEventListener('mousedown', startDrawing);
        drawingCanvas.removeEventListener('mousemove', draw);
        drawingCanvas.removeEventListener('mouseup', stopDrawing);
        drawingCanvas.removeEventListener('mouseout', stopDrawing);
    }
}
editModeBtn.addEventListener('click', toggleEditMode);

// --- Supabase Functions ---
async function saveAnnotations() {
    console.log('Saving annotations...');
    const annotationsToSave = [];
    for (const [page, data] of Object.entries(pageAnnotations)) {
        annotationsToSave.push({
            ebook_id: EBOOK_ID,
            page_number: parseInt(page),
            annotation_data: data
        });
    }

    if (annotationsToSave.length === 0) {
        console.log('No new annotations to save.');
        return;
    }

    // Upsert the data. It will update if ebook_id and page_number match, otherwise insert.
    const { data, error } = await supabase
        .from('annotations')
        .upsert(annotationsToSave, { onConflict: 'ebook_id, page_number' });

    if (error) {
        console.error('Error saving annotations:', error);
        alert('저장에 실패했습니다.');
    } else {
        console.log('Annotations saved successfully:', data);
        alert('저장되었습니다.');
    }
}
saveBtn.addEventListener('click', saveAnnotations);

async function loadAnnotations() {
    console.log('Loading annotations for book:', EBOOK_ID);
    const { data, error } = await supabase
        .from('annotations')
        .select('page_number, annotation_data')
        .eq('ebook_id', EBOOK_ID);

    if (error) {
        console.error('Error loading annotations:', error);
    } else {
        pageAnnotations = {}; // Clear local annotations
        data.forEach(item => {
            pageAnnotations[item.page_number] = item.annotation_data;
        });
        console.log('Annotations loaded from Supabase:', pageAnnotations);
    }
}

function redrawAnnotations(page) {
    const annotations = pageAnnotations[page];
    if (!annotations) return;

    ctx.strokeStyle = 'red';
    ctx.lineWidth = 2;

    annotations.forEach(path => {
        if (path.length === 0) return;
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) {
            ctx.lineTo(path[i].x, path[i].y);
        }
        ctx.stroke();
    });
}

// --- PDF & Page Rendering ---
async function renderPage(num) {
    const page = await pdfDoc.getPage(num);
    const viewport = page.getViewport({ scale: 1.5 });

    pdfCanvas.height = viewport.height;
    pdfCanvas.width = viewport.width;
    drawingCanvas.height = viewport.height;
    drawingCanvas.width = viewport.width;
    
    ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);

    const renderContext = {
        canvasContext: pdfCanvas.getContext('2d'),
        viewport: viewport
    };
    await page.render(renderContext).promise;

    pageNumSpan.textContent = num;
    redrawAnnotations(num); // Redraw saved annotations
}

// Page navigation
function goToPrevPage() {
    if (pageNum <= 1) return;
    pageNum--;
    renderPage(pageNum);
}

function goToNextPage() {
    if (pageNum >= pageCount) return;
    pageNum++;
    renderPage(pageNum);
}

prevPageBtn.addEventListener('click', goToPrevPage);
nextPageBtn.addEventListener('click', goToNextPage);

// Main logic to load the PDF
async function loadPdf() {
    const url = './sample.pdf';
    
    try {
        console.log('Loading PDF...');
        const loadingTask = pdfjsLib.getDocument(url);
        pdfDoc = await loadingTask.promise;
        console.log('PDF loaded successfully');
        
        pageCount = pdfDoc.numPages;
        pageCountSpan.textContent = pageCount;
        
        await loadAnnotations(); // Load annotations from Supabase
        renderPage(pageNum);
    } catch (err) {
        console.error('Error loading PDF:', err);
    }
}

loadPdf();
