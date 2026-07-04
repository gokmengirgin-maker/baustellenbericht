// --- APP LOGIC (Yöntem 2: JavaScript Page Builder) ---

// --- STATUS- UND DATENVERWALTUNG ---
let reportData = {
    entries: [],
    settings: {
        project: '',
        signatureTitle1: 'Auftragnehmer',
        signatureTitle2: 'Auftraggeber',
        signatureImage1: '',
        signatureImage2: '',
        email: '',
        firmaName: '',
        firmaLogo: '',
        headerTitle: 'Mehrkosten - {projekt}',
        mailSubject: 'Baustellenbericht: {projekt}',
        mailBody: 'Hallo,\n\nanbei finden Sie den aktuellen Baustellenbericht als PDF im Anhang.\n\nViele Grüße'
    }
};

let tempCompressedImages = [];
let tempCoords = null; // Geçici coğrafi konum bilgisini tutar
let editingImageIndex = -1;

// --- XSS KORUMAL HTML ESCAPE FONKSIYONU ---
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Daten beim Laden der Seite abrufen
window.onload = () => {
    // Icons laden (nach dem DOM-Aufbau, um Race Condition zu vermeiden)
    lucide.createIcons();

    loadFromStorage();

    // Skalierung bei Fenster-/Orientierungsänderung neu berechnen
    window.addEventListener('resize', () => {
        const previewTab = document.getElementById('tab-preview');
        if (previewTab && previewTab.classList.contains('active')) {
            applyPageScale();
        }
    });

    // Teilen-Button anzeigen, wenn iOS und Share-API verfügbar sind
    if (navigator.share) {
        document.getElementById('native-share-btn').classList.remove('hidden');
    }

    // Signature & Photo Editor init
    initSignatureCanvas();
    initPhotoEditor();
    updateSignaturePreviews();

    // Sayfa yüklendiğinde Lucide ikonlarını tekrar tetikle
    lucide.createIcons();

    // --- F12 / DevTools Engelleme ---
    document.addEventListener('contextmenu', function(e) {
        e.preventDefault();
    });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'F12') {
            e.preventDefault();
            return false;
        }
        if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i')) {
            e.preventDefault();
            return false;
        }
        if (e.ctrlKey && e.shiftKey && (e.key === 'J' || e.key === 'j')) {
            e.preventDefault();
            return false;
        }
        if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
            e.preventDefault();
            return false;
        }
        if (e.ctrlKey && (e.key === 'U' || e.key === 'u')) {
            e.preventDefault();
            return false;
        }
    });
};

function loadFromStorage() {
    const saved = localStorage.getItem('siteReportData');
    if (saved) {
        reportData = JSON.parse(saved);
        
        // Defaults for signatures
        if (!reportData.settings) reportData.settings = {};
        if (!reportData.settings.signatureTitle1) reportData.settings.signatureTitle1 = 'Auftragnehmer';
        if (!reportData.settings.signatureTitle2) reportData.settings.signatureTitle2 = 'Auftraggeber';
        if (reportData.settings.signatureImage1 === undefined) reportData.settings.signatureImage1 = '';
        if (reportData.settings.signatureImage2 === undefined) reportData.settings.signatureImage2 = '';
        if (!reportData.settings.nvtLabel) reportData.settings.nvtLabel = 'NVT:';

        document.getElementById('set-project').value      = reportData.settings.project || '';
        document.getElementById('set-sig-title-1').value = reportData.settings.signatureTitle1 || '';
        document.getElementById('set-sig-title-2').value = reportData.settings.signatureTitle2 || '';
        document.getElementById('set-email').value        = reportData.settings.email || '';
        document.getElementById('set-header-title').value = reportData.settings.headerTitle || 'Mehrkosten - {projekt}';
        document.getElementById('set-firma-name').value   = reportData.settings.firmaName || '';
        document.getElementById('set-mail-subject').value = reportData.settings.mailSubject || 'Baustellenbericht: {projekt}';
        document.getElementById('set-mail-body').value    = reportData.settings.mailBody || 'Hallo,\n\nanbei finden Sie den aktuellen Baustellenbericht als PDF im Anhang.\n\nViele Grüße';
        document.getElementById('set-nvt-label').value    = reportData.settings.nvtLabel || 'NVT:';

        // Logo varsa göster
        if (reportData.settings.firmaLogo) {
            const prev = document.getElementById('logo-preview');
            prev.src = reportData.settings.firmaLogo;
            prev.classList.remove('hidden');
            document.getElementById('remove-logo-btn').classList.remove('hidden');
        }

        updateSignaturePreviews();
        updateDynamicLabels();
        // renderPreview wird durch switchTab('tab-preview') ausgelöst
    }
}

function saveToStorage() {
    try {
        localStorage.setItem('siteReportData', JSON.stringify(reportData));
    } catch (e) {
        if (e.name === 'QuotaExceededError' || e.code === 22) {
            alert(
                "⚠️ Speicher voll!\n\n" +
                "Der Browser-Speicher ist ausgeschöpft (Bilder zu groß).\n" +
                "Bitte:\n" +
                "  1. PDF herunterladen und sichern\n" +
                "  2. Dann 'Zurücksetzen' klicken, um Platz zu schaffen."
            );
        } else {
            console.error('Speicherfehler:', e);
        }
    }
    // renderPreview wird von switchTab oder explizit aufgerufen
}

// --- TAB-VERWALTUNG ---
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('[id^="btn-tab-"]').forEach(btn => {
        btn.classList.remove('text-blue-600', 'border-b-2', 'border-blue-600');
        btn.classList.add('text-gray-500');
    });

    document.getElementById(tabId).classList.add('active');
    document.getElementById('btn-' + tabId).classList.remove('text-gray-500');
    document.getElementById('btn-' + tabId).classList.add('text-blue-600', 'border-b-2', 'border-blue-600');

    // Vorschau: zuerst rendern, dann skalieren (Tab ist jetzt sichtbar → clientWidth korrekt)
    if (tabId === 'tab-preview') {
        renderPreview();
        requestAnimationFrame(() => applyPageScale());
    }
}

// --- DYNAMISCHE METADATEN-BESCHRIFTUNGEN ---
function updateDynamicLabels() {
    const labelText = (reportData.settings.nvtLabel || 'NVT:').trim();
    // 1. Form-Tab: Label beim Eingabefeld aktualisieren
    const formLabel = document.getElementById('label-entry-nvt');
    if (formLabel) formLabel.innerText = labelText;
    // 2. Settings-Tab: Live-Preview Badge neben dem Label aktualisieren
    const previewBadge = document.getElementById('nvt-label-preview');
    if (previewBadge) previewBadge.innerText = labelText;
}

// --- EINSTELLUNGEN ---
function saveSettings() {
    reportData.settings.project     = document.getElementById('set-project').value;
    reportData.settings.signatureTitle1 = document.getElementById('set-sig-title-1').value;
    reportData.settings.signatureTitle2 = document.getElementById('set-sig-title-2').value;
    reportData.settings.email       = document.getElementById('set-email').value;
    reportData.settings.headerTitle = document.getElementById('set-header-title').value;
    reportData.settings.firmaName   = document.getElementById('set-firma-name').value;
    reportData.settings.mailSubject = document.getElementById('set-mail-subject').value;
    reportData.settings.mailBody    = document.getElementById('set-mail-body').value;
    reportData.settings.nvtLabel    = document.getElementById('set-nvt-label').value || 'NVT:';

    saveToStorage();
    updateDynamicLabels();
    renderPreview(); // Vorschau nach Einstellungen aktualisieren
    alert("Einstellungen gespeichert!");
    switchTab('tab-form');
}

// --- LOGO YÜKLEME (Canvas ile sıkıştırma) ---
async function loadLogo(event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
        const MAX_W = 300, MAX_H = 120;
        let bmp = await createImageBitmap(file);
        let w = bmp.width, h = bmp.height;
        const ratio = Math.min(MAX_W / w, MAX_H / h, 1);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);

        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
        bmp.close();

        const logoData = canvas.toDataURL('image/png');
        reportData.settings.firmaLogo = logoData;
        saveToStorage();

        const prev = document.getElementById('logo-preview');
        prev.src = logoData;
        prev.classList.remove('hidden');
        document.getElementById('remove-logo-btn').classList.remove('hidden');
    } catch(e) {
        alert('Fehler beim Laden des Logos.');
    }
}

function removeLogo() {
    reportData.settings.firmaLogo = '';
    saveToStorage();
    document.getElementById('logo-preview').classList.add('hidden');
    document.getElementById('remove-logo-btn').classList.add('hidden');
    const old = document.getElementById('set-logo');
    const neu = old.cloneNode(true);
    old.parentNode.replaceChild(neu, old);
}

function clearAllData() {
    if(confirm("Alle gespeicherten Berichte und Seiten werden unwiderruflich gelöscht. Sind Sie sicher?")) {
        reportData.entries = [];
        saveToStorage();
        document.getElementById('entry-text').value = '';
        if(document.getElementById('entry-adresse')) document.getElementById('entry-adresse').value = '';
        if(document.getElementById('entry-nvt')) document.getElementById('entry-nvt').value = '';
        const container = document.getElementById('image-preview-container');
        if (container) {
            container.classList.add('hidden');
            container.innerHTML = '';
        }
        tempCompressedImages = [];
        tempCoords = null;
        alert("Daten erfolgreich zurückgesetzt.");
    }
}

// --- BILDVERARBEITUNG UND ZEITSTEMPEL ---
async function compressImage(file) {
    return new Promise(async (resolve, reject) => {
        try {
            let source, drawWidth, drawHeight;

            if (typeof createImageBitmap !== 'undefined') {
                try {
                    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
                } catch (e) {
                    source = await createImageBitmap(file);
                }
                drawWidth  = source.width;
                drawHeight = source.height;
            } else {
                source = await new Promise((resolve2, reject2) => {
                    const reader = new FileReader();
                    reader.onload = e => {
                        const img = new Image();
                        img.onload = () => resolve2(img);
                        img.onerror = reject2;
                        img.src = e.target.result;
                    };
                    reader.onerror = reject2;
                    reader.readAsDataURL(file);
                });
                drawWidth  = source.width;
                drawHeight = source.height;
            }

            const MAX_WIDTH  = 1200;
            const MAX_HEIGHT = 900;
            const scaleRatio = Math.min(
                drawWidth  > MAX_WIDTH  ? MAX_WIDTH  / drawWidth  : 1,
                drawHeight > MAX_HEIGHT ? MAX_HEIGHT / drawHeight : 1
            );
            if (scaleRatio < 1) {
                drawWidth  = Math.round(drawWidth  * scaleRatio);
                drawHeight = Math.round(drawHeight * scaleRatio);
            }

            const canvas = document.createElement('canvas');
            canvas.width  = drawWidth;
            canvas.height = drawHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(source, 0, 0, drawWidth, drawHeight);
            if (source.close) source.close();

            const now = new Date();
            const timestamp = now.toLocaleDateString('de-DE') + ' ' + now.toLocaleTimeString('de-DE');
            ctx.font        = `bold ${Math.round(drawWidth / 40)}px Arial`;
            ctx.fillStyle   = 'white';
            ctx.shadowColor = 'black';
            ctx.shadowBlur  = 4;
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 2;
            ctx.textAlign   = 'right';
            ctx.fillText(timestamp, drawWidth - 20, drawHeight - 20);
            ctx.fillText(reportData.settings.project || '', drawWidth - 20, drawHeight - 52);

            resolve(canvas.toDataURL('image/jpeg', 0.7));
        } catch (err) {
            reject(err);
        }
    });
}

async function previewSelectedImages(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const MAX_PHOTOS = 4;

    if (tempCompressedImages.length >= MAX_PHOTOS) {
        alert(`Maximal ${MAX_PHOTOS} Fotos pro Eintrag erlaubt. Bitte löschen Sie zuerst ein Foto.`);
        return;
    }

    const remaining = MAX_PHOTOS - tempCompressedImages.length;
    const filesToLoad = Math.min(files.length, remaining);

    if (files.length > remaining) {
        alert(`Es werden nur ${filesToLoad} von ${files.length} Fotos hinzugefügt (Limit: ${MAX_PHOTOS} Fotos pro Eintrag).`);
    }

    if (navigator.geolocation && !tempCoords) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                tempCoords = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude
                };
                const currentAddrInput = document.getElementById('entry-adresse');
                if (!currentAddrInput.value.trim()) {
                    getAddressFromCoords(tempCoords.latitude, tempCoords.longitude);
                }
            },
            (error) => {
                console.warn("Konum alınamadı:", error.message);
            },
            { enableHighAccuracy: true, timeout: 5000 }
        );
    }

    for (let i = 0; i < filesToLoad; i++) {
        try {
            const dataUrl = await compressImage(files[i]);
            tempCompressedImages.push(dataUrl);
        } catch (err) {
            console.error('Bildfehler:', err);
        }
    }

    // Clear input value so that the change event triggers again for consecutive camera/gallery uploads
    event.target.value = '';

    renderFormImagePreviews();
}


function renderFormImagePreviews() {
    const container = document.getElementById('image-preview-container');
    if (!container) return;

    if (tempCompressedImages.length === 0) {
        container.innerHTML = '';
        container.classList.add('hidden');
        return;
    }

    const MAX_PHOTOS = 4;
    const count = tempCompressedImages.length;
    const atLimit = count >= MAX_PHOTOS;

    container.classList.remove('hidden');

    // Zähler-Badge oben
    let html = `
        <div class="col-span-full flex items-center justify-between mb-1">
            <span class="text-xs font-semibold text-gray-600">Fotos: <span class="${atLimit ? 'text-red-500' : 'text-green-600'}">${count} / ${MAX_PHOTOS}</span></span>
            ${atLimit ? '<span class="text-xs text-red-500 font-semibold">⚠ Limit erreicht</span>' : `<span class="text-xs text-gray-400">${MAX_PHOTOS - count} Slot(s) frei</span>`}
        </div>`;

    tempCompressedImages.forEach((img, index) => {
        html += `
        <div class="relative group border border-gray-200 rounded-lg overflow-hidden bg-gray-50 h-32 flex items-center justify-center">
            <img src="${img}" class="max-h-full max-w-full object-contain" />
            <div class="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                <button type="button" onclick="editFormImage(${index}, event)" class="bg-blue-600 text-white p-1.5 rounded-full hover:bg-blue-700 transition" title="Bearbeiten">
                    <i data-lucide="edit-3" class="w-4 h-4"></i>
                </button>
                <button type="button" onclick="deleteFormImage(${index}, event)" class="bg-red-600 text-white p-1.5 rounded-full hover:bg-red-700 transition" title="Löschen">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
            </div>
        </div>`;
    });
    container.innerHTML = html;
    lucide.createIcons();
}


function deleteFormImage(index, event) {
    if (event) event.preventDefault();
    tempCompressedImages.splice(index, 1);
    renderFormImagePreviews();
}

function editFormImage(index, event) {
    if (event) event.preventDefault();
    editingImageIndex = index;
    
    const modal = document.getElementById('photo-editor-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    lucide.createIcons();
    
    editorImage = new Image();
    editorImage.onload = function() {
        editorCanvas.width = editorImage.naturalWidth || editorImage.width;
        editorCanvas.height = editorImage.naturalHeight || editorImage.height;
        editorCanvas.style.maxWidth = '100%';
        editorCanvas.style.maxHeight = '65vh';
        
        editorHistory = [];
        currentShape = null;
        
        redrawEditorCanvas();
    };
    editorImage.src = tempCompressedImages[index];
}

// --- OTOMATİK ADRES BULMA (Reverse Geocoding) ---
function fetchCurrentAddress(e) {
    if (e) e.preventDefault();
    const btn = document.getElementById('btn-get-address');
    const originalHtml = btn.innerHTML;

    if (!navigator.geolocation) {
        alert("GPS-Standort wird von Ihrem Gerät nicht unterstützt.");
        return;
    }

    btn.disabled = true;
    btn.innerHTML = `<span class="animate-spin mr-1">⌛</span> <span class="text-xs">Lade...</span>`;

    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            
            tempCoords = { latitude: lat, longitude: lon };

            await getAddressFromCoords(lat, lon);
            
            btn.disabled = false;
            btn.innerHTML = originalHtml;
            lucide.createIcons();
        },
        (error) => {
            alert("Standort konnte nicht ermittelt werden: " + error.message);
            btn.disabled = false;
            btn.innerHTML = originalHtml;
            lucide.createIcons();
        },
        { enableHighAccuracy: true, timeout: 8000 }
    );
}

async function getAddressFromCoords(lat, lon) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1`, {
            headers: {
                'Accept-Language': 'de'
            }
        });
        
        if (!response.ok) throw new Error("API-Fehler");
        
        const data = await response.json();
        if (data && data.address) {
            const addr = data.address;
            const street = addr.road || addr.suburb || '';
            const houseNumber = addr.house_number || '';
            const postcode = addr.postcode || '';
            const city = addr.city || addr.town || addr.village || '';
            
            let formattedAddress = '';
            if (street) formattedAddress += street;
            if (houseNumber) formattedAddress += ' ' + houseNumber;
            if (formattedAddress && (postcode || city)) formattedAddress += ', ';
            if (postcode) formattedAddress += postcode + ' ';
            if (city) formattedAddress += city;

            if (formattedAddress) {
                document.getElementById('entry-adresse').value = formattedAddress.trim();
            }
        }
    } catch (err) {
        console.error("Adressfehler:", err);
    }
}

function addEntry() {
    const text    = document.getElementById('entry-text').value.trim();
    const adresse = document.getElementById('entry-adresse').value.trim();
    const nvt     = document.getElementById('entry-nvt').value.trim();
    
    if (!text) {
        alert("Bitte geben Sie eine Beschreibung (Befund) ein!");
        return;
    }

    if (tempCompressedImages.length === 0) {
        alert("Bitte machen Sie zuerst ein Foto oder fügen Sie eines hinzu!");
        return;
    }

    const now = new Date();
    const dateStr = now.toLocaleDateString('de-DE') + ' ' + now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

    const MAX_PHOTOS = 4;
    const imagesToSave = tempCompressedImages.slice(0, MAX_PHOTOS);

    reportData.entries.push({
        text:    text,
        adresse: adresse,
        nvt:     nvt,
        image:   imagesToSave[0], // Abwärtskompatibilität
        images:  imagesToSave,
        date:    dateStr,
        coords:  tempCoords ? { ...tempCoords } : null
    });

    saveToStorage();

    document.getElementById('entry-text').value    = '';
    document.getElementById('entry-adresse').value = '';
    document.getElementById('entry-nvt').value     = '';
    const previewContainer = document.getElementById('image-preview-container');
    if (previewContainer) {
        previewContainer.classList.add('hidden');
        previewContainer.innerHTML = '';
    }
    tempCompressedImages = [];
    tempCoords = null;

    ['entry-image-camera', 'entry-image-gallery'].forEach(id => {
        const old = document.getElementById(id);
        if (old) {
            const neu = old.cloneNode(true);
            old.parentNode.replaceChild(neu, old);
        }
    });

    alert("Seite zum Bericht hinzugefügt! Sie können sie in der Vorschau sehen.");
    switchTab('tab-preview');
}

// --- BERICHT-VORSCHAU (Yöntem 2: JavaScript Page Builder mit Skalierung) ---

// Skalierungsfunktion: passt alle Seiten an die aktuelle Container-Breite an
function applyPageScale() {
    const container = document.getElementById('report-preview');
    if (!container) return;
    const wrappers = container.querySelectorAll('.pdf-page-wrapper');
    if (wrappers.length === 0) return;

    // PDF-Generation mode oder versteckter Tab: keine Skalierung
    if (container.classList.contains('pdf-generation-mode')) return;
    if (container.clientWidth === 0) return; // Tab ist versteckt

    // Verfügbare Breite des Containers (minus Padding)
    const availableWidth = container.clientWidth - 24; // 12px padding links + rechts
    const scale = Math.max(0.1, Math.min(1, availableWidth / 794));

    wrappers.forEach(wrapper => {
        const page = wrapper.querySelector('.pdf-page');
        if (!page) return;
        page.style.transform = `scale(${scale})`;
        wrapper.style.height = Math.round(1123 * scale) + 'px';
    });
}

function renderPreview() {
    const container = document.getElementById('report-preview');
    if (!container) return;
    container.innerHTML = '';

    const countEl = document.getElementById('entry-count');
    if (countEl) countEl.innerText = reportData.entries.length;

    if (reportData.entries.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-400 py-10">Noch keine Einträge hinzugefügt.</p>';
        return;
    }

    let pageCount = 0;
    let currentPage = null;
    let currentWrapper = null;
    let currentContentArea = null;

    function createNewPage() {
        pageCount++;

        // Wrapper-Div (für Skalierung)
        const wrapper = document.createElement('div');
        wrapper.className = 'pdf-page-wrapper';

        // Eigentliche A4-Seite
        const page = document.createElement('div');
        page.className = 'pdf-page';

        const headerTitle = (reportData.settings.headerTitle || 'Mehrkosten - {projekt}')
            .replace('{projekt}', reportData.settings.project || '');
        const logoHtml = reportData.settings.firmaLogo
            ? `<img src="${reportData.settings.firmaLogo}" style="max-height:50px;max-width:150px;object-fit:contain;" />` : '';
        const firmaNameHtml = reportData.settings.firmaName
            ? `<p class="text-xs text-gray-600 mt-0.5">${escapeHtml(reportData.settings.firmaName)}</p>` : '';

        page.innerHTML = `
            <div class="pdf-header border-b-2 border-black mb-3 pb-1 flex justify-between items-start">
                <div>
                    <h2 class="font-bold text-base uppercase">${headerTitle}</h2>
                    ${firmaNameHtml}
                </div>
                ${logoHtml}
            </div>
            <div class="pdf-content flex flex-col gap-3 flex-1"></div>
            <div class="pdf-footer mt-auto pt-3 flex justify-between items-center text-[10px] text-gray-400 border-t border-gray-100">
                <span class="page-num">Seite ${pageCount}</span>
            </div>
        `;

        wrapper.appendChild(page);
        container.appendChild(wrapper);

        currentPage = page;
        currentWrapper = wrapper;
        currentContentArea = page.querySelector('.pdf-content');

        return { page, wrapper };
    }

    createNewPage();

    reportData.entries.forEach((entry, entryIndex) => {
        // Jeder Eintrag beginnt immer auf einer neuen Seite
        if (entryIndex > 0) {
            createNewPage();
        }

        const entryImages = entry.images || (entry.image ? [entry.image] : []);

        // 1. Metadata
        const metadataDiv = document.createElement('div');
        metadataDiv.className = 'entry-metadata';
        const adresseHtml = entry.adresse
            ? `<div class="col-span-1"><span class="font-bold block border-b border-gray-200 text-xs">Adresse:</span><p class="mt-0.5 text-[11px] break-words">${escapeHtml(entry.adresse)}</p></div>`
            : '<div class="col-span-1"></div>';
        const nvtLabel = reportData.settings.nvtLabel || 'NVT:';
        const nvtHtml = entry.nvt
            ? `<div class="col-span-1"><span class="font-bold block border-b border-gray-200 text-xs">${escapeHtml(nvtLabel)}</span><p class="mt-0.5 text-[11px]">${escapeHtml(entry.nvt)}</p></div>`
            : '<div class="col-span-1"></div>';
        const dateHtml = `<div class="col-span-1"><span class="font-bold block border-b border-gray-200 text-xs">Datum:</span><p class="mt-0.5 text-[11px]">${entry.date}</p></div>`;
        metadataDiv.innerHTML = `
            <div class="grid grid-cols-3 gap-3 border-b border-gray-200 pb-2">
                ${adresseHtml}${nvtHtml}${dateHtml}
            </div>`;

        // 2. Beschreibung
        const descriptionDiv = document.createElement('div');
        descriptionDiv.className = 'entry-description';
        descriptionDiv.innerHTML = `
            <div>
                <span class="font-bold block border-b border-gray-200 text-xs">Befund / Beschreibung:</span>
                <p class="mt-0.5 whitespace-pre-wrap text-[11px] leading-relaxed text-gray-700">${escapeHtml(entry.text)}</p>
            </div>`;

        currentContentArea.appendChild(metadataDiv);
        currentContentArea.appendChild(descriptionDiv);



        // 3. Bilder
        const imagesDiv = document.createElement('div');
        imagesDiv.className = 'entry-images mt-1';

        // Max 4 Fotos pro Eintrag (Sicherheitsnetz)
        const displayImages = entryImages.slice(0, 4);

        let gridClass = 'grid-cols-2';
        let imgMaxHeight = '230px';
        if (displayImages.length === 1) { gridClass = 'grid-cols-1'; imgMaxHeight = '420px'; }
        else if (displayImages.length === 3) { gridClass = 'grid-cols-3'; imgMaxHeight = '200px'; }
        else { gridClass = 'grid-cols-2'; imgMaxHeight = '230px'; } // 2 oder 4 Fotos → 2 Spalten


        const imagesMarkup = displayImages.map(imgUrl => `
            <div class="flex items-center justify-center bg-gray-50 rounded border border-gray-100 p-0.5">
                ${entry.coords
                    ? `<a href="https://www.google.com/maps?q=${entry.coords.latitude},${entry.coords.longitude}" target="_blank" class="w-full flex justify-center">
                        <img src="${imgUrl}" class="max-w-full h-auto object-scale-down rounded" style="max-height:${imgMaxHeight};display:block;" />
                       </a>`
                    : `<img src="${imgUrl}" class="max-w-full h-auto object-scale-down rounded" style="max-height:${imgMaxHeight};display:block;" />`
                }
            </div>`).join('');


        const mapLink = entry.coords
            ? `<div class="mt-1.5 text-[10px] text-blue-600 font-semibold text-center w-full">
                <a href="https://www.google.com/maps?q=${entry.coords.latitude},${entry.coords.longitude}" target="_blank" class="inline-flex items-center gap-1 justify-center hover:underline">
                    📍 Auf Google Maps anzeigen
                </a>
               </div>` : '';

        imagesDiv.innerHTML = `<div class="grid ${gridClass} gap-2">${imagesMarkup}</div>${mapLink}`;

        currentContentArea.appendChild(imagesDiv);

        if (currentPage.scrollHeight > 1123) {
            currentContentArea.removeChild(imagesDiv);
            createNewPage();
            const contNotice = document.createElement('p');
            contNotice.className = 'text-[10px] text-gray-400 italic mb-1';
            contNotice.innerText = `Fortsetzung Eintrag ${entryIndex + 1}: Fotos`;
            currentContentArea.appendChild(contNotice);
            currentContentArea.appendChild(imagesDiv);
        }
    });

    // 4. Unterschriften
    const signatureDiv = document.createElement('div');
    signatureDiv.className = 'signature-block mt-auto pt-3 border-t border-gray-300 grid grid-cols-2 gap-8 w-full';
    signatureDiv.innerHTML = `
        <div class="text-center flex flex-col justify-end items-center h-20">
            <p class="text-[10px] text-gray-500 font-semibold mb-0.5">${escapeHtml(reportData.settings.signatureTitle1) || 'Auftragnehmer'}</p>
            <div class="h-10 flex items-center justify-center">
                ${reportData.settings.signatureImage1 ? `<img src="${reportData.settings.signatureImage1}" class="max-h-10 max-w-full object-contain" />` : ''}
            </div>
            <div class="border-t border-gray-300 w-3/4 mt-0.5"></div>
            <p class="text-[8px] text-gray-400 mt-0.5">Unterschrift / Stempel</p>
        </div>
        <div class="text-center flex flex-col justify-end items-center h-20">
            <p class="text-[10px] text-gray-500 font-semibold mb-0.5">${escapeHtml(reportData.settings.signatureTitle2) || 'Auftraggeber'}</p>
            <div class="h-10 flex items-center justify-center">
                ${reportData.settings.signatureImage2 ? `<img src="${reportData.settings.signatureImage2}" class="max-h-10 max-w-full object-contain" />` : ''}
            </div>
            <div class="border-t border-gray-300 w-3/4 mt-0.5"></div>
            <p class="text-[8px] text-gray-400 mt-0.5">Unterschrift / Stempel</p>
        </div>`;

    currentContentArea.appendChild(signatureDiv);

    if (currentPage.scrollHeight > 1123) {
        currentContentArea.removeChild(signatureDiv);
        createNewPage();
        currentContentArea.appendChild(signatureDiv);
    }

    // Seitennummern aktualisieren
    const pages = container.querySelectorAll('.pdf-page');
    pages.forEach((p, idx) => {
        p.querySelector('.page-num').innerText = `Seite ${idx + 1} / ${pages.length}`;
    });

    // Skala auf alle Seiten anwenden
    applyPageScale();
}


// --- PDF HERUNTERLADEN UND TEILEN ---
function generatePDF() {
    if (reportData.entries.length === 0) {
        alert("Fügen Sie zuerst einen Eintrag hinzu, um eine PDF zu erstellen.");
        return;
    }

    const element = document.getElementById('report-preview');
    element.classList.add('pdf-generation-mode');
    
    const now = new Date();
    const timeStamp = now.toLocaleDateString('de-DE') + '_' + now.toTimeString().split(' ')[0].replace(/:/g, '-');
    
    // Pixel-Genaues PDF Setup (A4 exact px matching)
    const opt = {
        margin:       0,
        filename:     `Baustellenbericht_${timeStamp}.pdf`,
        image:        { type: 'jpeg', quality: 0.95 },
        html2canvas:  { scale: 2, useCORS: true, logging: false },
        jsPDF:        { unit: 'px', format: [794, 1123], hotfixes: ['px_scaling'] },
        pageBreak:    { mode: ['css', 'legacy'] }
    };

    html2pdf().set(opt).from(element).save().then(() => {
        element.classList.remove('pdf-generation-mode');
    }).catch(err => {
        console.error(err);
        element.classList.remove('pdf-generation-mode');
    });
}

// --- PER OUTLOOK / MAIL SENDEN (MAILTO) ---
function shareViaEmail() {
     if (reportData.entries.length === 0) {
        alert("Fügen Sie zuerst einen Eintrag hinzu, um ihn zu senden.");
        return;
    }

    const to = reportData.settings.email;
    if (!to || to.trim() === '') {
        alert("Bitte geben Sie zuerst eine Ziel-E-Mail-Adresse in den Einstellungen ein!");
        switchTab('tab-settings');
        return;
    }
    
    let rawSubject = reportData.settings.mailSubject || `Baustellenbericht: ${reportData.settings.project}`;
    rawSubject = rawSubject.replace('{projekt}', reportData.settings.project || '');
    
    const subject = encodeURIComponent(rawSubject);
    
    let rawBody = reportData.settings.mailBody || 'Anbei der Bericht.';
    const bodyText = encodeURIComponent(rawBody);
    
    window.location.href = `mailto:${to}?subject=${subject}&body=${bodyText}`;
}

// --- IOS / ANDROID NATIVE SHARE (WhatsApp etc.) ---
async function nativeShare() {
    if (reportData.entries.length === 0) return;
    
    try {
        const element = document.getElementById('report-preview');
        element.classList.add('pdf-generation-mode');
        
        const opt = { 
            margin: 0, 
            filename: 'bericht.pdf', 
            image: { type: 'jpeg', quality: 0.98 }, 
            html2canvas: { scale: 2, useCORS: true, logging: false }, 
            jsPDF: { unit: 'px', format: [794, 1123], hotfixes: ['px_scaling'] },
            pageBreak: { mode: ['css', 'legacy'] }
        };
        const pdfBlob = await html2pdf().set(opt).from(element).output('blob');
        element.classList.remove('pdf-generation-mode');

        const file = new File([pdfBlob], `Bericht_${Date.now()}.pdf`, { type: "application/pdf" });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
                title: 'Baustellenbericht',
                text: `${reportData.settings.project} - Baustellenbericht`,
                files: [file]
            });
        } else {
            alert("Ihr Gerät unterstützt das direkte Teilen von PDFs nicht. Bitte verwenden Sie den Button 'PDF herunterladen'.");
        }
    } catch (error) {
        console.error("Teilen-Fehler:", error);
        alert("Beim Teilen ist ein Fehler aufgetreten.");
        const element = document.getElementById('report-preview');
        if (element) element.classList.remove('pdf-generation-mode');
    }
}

// --- DIGITALE UNTERSCHRIFTEN (CANVAS & IMAGE UPLOAD) ---
let currentSigIndex = 1;
let sigCanvas = null;
let sigCtx = null;
let isSigDrawing = false;
let lastSigX = 0;
let lastSigY = 0;

function initSignatureCanvas() {
    sigCanvas = document.getElementById('sig-canvas');
    if (!sigCanvas) return;
    sigCtx = sigCanvas.getContext('2d');

    sigCanvas.addEventListener('mousedown', (e) => {
        isSigDrawing = true;
        const pos = getCanvasMousePos(e);
        lastSigX = pos.x;
        lastSigY = pos.y;
    });
    sigCanvas.addEventListener('mousemove', (e) => {
        if (!isSigDrawing) return;
        const pos = getCanvasMousePos(e);
        drawSigLine(lastSigX, lastSigY, pos.x, pos.y);
        lastSigX = pos.x;
        lastSigY = pos.y;
    });
    sigCanvas.addEventListener('mouseup', () => { isSigDrawing = false; });
    sigCanvas.addEventListener('mouseleave', () => { isSigDrawing = false; });

    sigCanvas.addEventListener('touchstart', (e) => {
        isSigDrawing = true;
        const pos = getCanvasTouchPos(e);
        lastSigX = pos.x;
        lastSigY = pos.y;
        e.preventDefault();
    }, { passive: false });
    sigCanvas.addEventListener('touchmove', (e) => {
        if (!isSigDrawing) return;
        const pos = getCanvasTouchPos(e);
        drawSigLine(lastSigX, lastSigY, pos.x, pos.y);
        lastSigX = pos.x;
        lastSigY = pos.y;
        e.preventDefault();
    }, { passive: false });
    sigCanvas.addEventListener('touchend', (e) => {
        isSigDrawing = false;
        e.preventDefault();
    }, { passive: false });
}

function getCanvasMousePos(e) {
    const rect = sigCanvas.getBoundingClientRect();
    return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
}

function getCanvasTouchPos(e) {
    const rect = sigCanvas.getBoundingClientRect();
    if (e.touches.length === 0) return { x: 0, y: 0 };
    return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top
    };
}

function drawSigLine(x1, y1, x2, y2) {
    sigCtx.beginPath();
    sigCtx.strokeStyle = '#000000';
    sigCtx.lineWidth = 3;
    sigCtx.lineCap = 'round';
    sigCtx.lineJoin = 'round';
    sigCtx.moveTo(x1, y1);
    sigCtx.lineTo(x2, y2);
    sigCtx.stroke();
    sigCtx.closePath();
}

function openSignaturePad(index, e) {
    if (e) e.preventDefault();
    currentSigIndex = index;
    
    const modal = document.getElementById('sig-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    const title = index === 1 
        ? (reportData.settings.signatureTitle1 || 'Auftragnehmer')
        : (reportData.settings.signatureTitle2 || 'Auftraggeber');
    document.getElementById('sig-modal-title').innerText = `${title} - Unterschrift`;

    setTimeout(() => {
        sigCanvas.width = sigCanvas.clientWidth;
        sigCanvas.height = sigCanvas.clientHeight;
        clearSignatureCanvas();
    }, 100);
}

function closeSignaturePad(e) {
    if (e) e.preventDefault();
    const modal = document.getElementById('sig-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
}

function clearSignatureCanvas(e) {
    if (e) e.preventDefault();
    sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
}

function saveSignatureCanvas(e) {
    if (e) e.preventDefault();
    
    const dataURL = sigCanvas.toDataURL('image/png');
    const buffer = new Uint32Array(sigCtx.getImageData(0, 0, sigCanvas.width, sigCanvas.height).data.buffer);
    const isBlank = !buffer.some(color => color !== 0);
    
    if (isBlank) {
        alert("Bitte zeichnen Sie zuerst eine Unterschrift!");
        return;
    }
    
    if (currentSigIndex === 1) {
        reportData.settings.signatureImage1 = dataURL;
    } else {
        reportData.settings.signatureImage2 = dataURL;
    }
    
    saveToStorage();
    updateSignaturePreviews();
    closeSignaturePad();
    lucide.createIcons();
}

async function uploadSignatureImage(index, event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
        const MAX_W = 400, MAX_H = 150;
        let bmp = await createImageBitmap(file);
        let w = bmp.width, h = bmp.height;
        const ratio = Math.min(MAX_W / w, MAX_H / h, 1);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);

        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
        bmp.close();

        const imgData = canvas.toDataURL('image/png');
        if (index === 1) {
            reportData.settings.signatureImage1 = imgData;
        } else {
            reportData.settings.signatureImage2 = imgData;
        }
        saveToStorage();
        updateSignaturePreviews();
        lucide.createIcons();
    } catch(e) {
        alert('Fehler beim Laden der Unterschrift.');
    }
}

function clearSignatureImage(index, event) {
    if (event) event.preventDefault();
    if (index === 1) {
        reportData.settings.signatureImage1 = '';
    } else {
        reportData.settings.signatureImage2 = '';
    }
    saveToStorage();
    updateSignaturePreviews();
    lucide.createIcons();
}

function updateSignaturePreviews() {
    for (let index = 1; index <= 2; index++) {
        const imgData = index === 1 ? reportData.settings.signatureImage1 : reportData.settings.signatureImage2;
        const preview = document.getElementById(`sig-preview-${index}`);
        const placeholder = document.getElementById(`sig-placeholder-${index}`);
        const clearBtn = document.getElementById(`btn-clear-sig-${index}`);
        
        if (imgData) {
            preview.src = imgData;
            preview.classList.remove('hidden');
            placeholder.classList.add('hidden');
            clearBtn.classList.remove('hidden');
        } else {
            preview.src = '';
            preview.classList.add('hidden');
            placeholder.classList.remove('hidden');
            clearBtn.classList.add('hidden');
        }
    }
}

// --- PHOTO EDITOR FUNCTIONS ---
let editorCanvas = null;
let editorCtx = null;
let editorImage = null;
let editorHistory = [];
let currentShape = null;
let editorTool = 'pen';
let editorColor = '#ef4444';
let isEditorDrawing = false;

function initPhotoEditor() {
    editorCanvas = document.getElementById('editor-canvas');
    if (!editorCanvas) return;
    editorCtx = editorCanvas.getContext('2d');
    
    editorCanvas.addEventListener('mousedown', (e) => {
        if (!editorImage) return;
        isEditorDrawing = true;
        const pos = getEditorCanvasCoords(e);
        currentShape = {
            type: editorTool,
            color: editorColor,
            points: [pos]
        };
    });
    editorCanvas.addEventListener('mousemove', (e) => {
        if (!isEditorDrawing) return;
        const pos = getEditorCanvasCoords(e);
        if (editorTool === 'pen') {
            currentShape.points.push(pos);
        } else if (editorTool === 'arrow') {
            currentShape.points[1] = pos;
        }
        redrawEditorCanvas();
        drawShape(currentShape);
    });
    editorCanvas.addEventListener('mouseup', (e) => {
        if (!isEditorDrawing) return;
        isEditorDrawing = false;
        if (!currentShape) return;
        const pos = getEditorCanvasCoords(e);
        if (editorTool === 'pen') {
            currentShape.points.push(pos);
            if (currentShape.points.length >= 2) {
                editorHistory.push(currentShape);
            }
        } else if (editorTool === 'arrow') {
            currentShape.points[1] = pos;
            if (currentShape.points[0] && currentShape.points[1]) {
                editorHistory.push(currentShape);
            }
        }
        currentShape = null;
        redrawEditorCanvas();
    });
    editorCanvas.addEventListener('mouseleave', () => {
        if (!isEditorDrawing || !currentShape) return;
        isEditorDrawing = false;
        if (editorTool === 'pen' && currentShape.points.length >= 2) {
            editorHistory.push(currentShape);
        } else if (editorTool === 'arrow' && currentShape.points[0] && currentShape.points[1]) {
            editorHistory.push(currentShape);
        }
        currentShape = null;
        redrawEditorCanvas();
    });
    document.addEventListener('mouseup', () => {
        if (isEditorDrawing) {
            isEditorDrawing = false;
            currentShape = null;
            redrawEditorCanvas();
        }
    });
    
    editorCanvas.addEventListener('touchstart', (e) => {
        if (!editorImage) return;
        isEditorDrawing = true;
        const pos = getEditorCanvasCoords(e);
        currentShape = {
            type: editorTool,
            color: editorColor,
            points: [pos]
        };
        e.preventDefault();
    }, { passive: false });
    editorCanvas.addEventListener('touchmove', (e) => {
        if (!isEditorDrawing) return;
        const pos = getEditorCanvasCoords(e);
        if (editorTool === 'pen') {
            currentShape.points.push(pos);
        } else if (editorTool === 'arrow') {
            currentShape.points[1] = pos;
        }
        redrawEditorCanvas();
        drawShape(currentShape);
        e.preventDefault();
    }, { passive: false });
    editorCanvas.addEventListener('touchend', (e) => {
        if (!isEditorDrawing) return;
        isEditorDrawing = false;
        if (currentShape) {
            if (editorTool === 'pen' && currentShape.points.length >= 2) {
                editorHistory.push(currentShape);
            } else if (editorTool === 'arrow' && currentShape.points[0] && currentShape.points[1]) {
                editorHistory.push(currentShape);
            }
            currentShape = null;
        }
        redrawEditorCanvas();
        e.preventDefault();
    }, { passive: false });
}

function getEditorCanvasCoords(e) {
    const rect = editorCanvas.getBoundingClientRect();
    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
    }
    const x = (clientX - rect.left) * (editorCanvas.width / rect.width);
    const y = (clientY - rect.top) * (editorCanvas.height / rect.height);
    return { x, y };
}

function drawShape(shape) {
    editorCtx.strokeStyle = shape.color;
    editorCtx.fillStyle = shape.color;
    editorCtx.lineWidth = 6;
    editorCtx.lineCap = 'round';
    editorCtx.lineJoin = 'round';
    
    if (shape.type === 'pen') {
        if (shape.points.length < 2) return;
        editorCtx.beginPath();
        editorCtx.moveTo(shape.points[0].x, shape.points[0].y);
        for (let i = 1; i < shape.points.length; i++) {
            editorCtx.lineTo(shape.points[i].x, shape.points[i].y);
        }
        editorCtx.stroke();
        editorCtx.closePath();
    } else if (shape.type === 'arrow') {
        const p1 = shape.points[0];
        const p2 = shape.points[1];
        if (!p1 || !p2) return;
        
        const headlen = 24;
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const angle = Math.atan2(dy, dx);
        
        editorCtx.beginPath();
        editorCtx.moveTo(p1.x, p1.y);
        editorCtx.lineTo(p2.x, p2.y);
        editorCtx.stroke();
        
        editorCtx.beginPath();
        editorCtx.moveTo(p2.x, p2.y);
        editorCtx.lineTo(p2.x - headlen * Math.cos(angle - Math.PI / 6), p2.y - headlen * Math.sin(angle - Math.PI / 6));
        editorCtx.lineTo(p2.x - headlen * Math.cos(angle + Math.PI / 6), p2.y - headlen * Math.sin(angle + Math.PI / 6));
        editorCtx.closePath();
        editorCtx.fill();
    }
}

function redrawEditorCanvas() {
    if (!editorImage || !editorCanvas) return;
    editorCtx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);
    editorCtx.drawImage(editorImage, 0, 0, editorCanvas.width, editorCanvas.height);
    editorHistory.forEach(shape => {
        drawShape(shape);
    });
}

function openPhotoEditor(e) {
    if (e) e.preventDefault();
    if (tempCompressedImages.length === 0) {
        alert("Bitte wählen Sie zuerst ein Foto aus!");
        return;
    }
    editFormImage(0, e);
}

function closePhotoEditor(e) {
    if (e) e.preventDefault();
    const modal = document.getElementById('photo-editor-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
    isEditorDrawing = false;
    currentShape = null;
    editorImage = null;
}

function setEditorTool(tool, e) {
    if (e) e.preventDefault();
    editorTool = tool;
    
    const penBtn = document.getElementById('tool-pen');
    const arrowBtn = document.getElementById('tool-arrow');
    
    if (tool === 'pen') {
        penBtn.className = "bg-blue-600 text-white border border-blue-600 px-3 py-1.5 rounded text-xs font-semibold flex items-center gap-1 transition";
        arrowBtn.className = "bg-white text-gray-700 border border-gray-300 px-3 py-1.5 rounded text-xs font-semibold flex items-center gap-1 transition";
    } else {
        penBtn.className = "bg-white text-gray-700 border border-gray-300 px-3 py-1.5 rounded text-xs font-semibold flex items-center gap-1 transition";
        arrowBtn.className = "bg-blue-600 text-white border border-blue-600 px-3 py-1.5 rounded text-xs font-semibold flex items-center gap-1 transition";
    }
}

function setEditorColor(color, e) {
    if (e) e.preventDefault();
    editorColor = color;
    
    const colors = {
        '#ef4444': 'color-red',
        '#22c55e': 'color-green',
        '#3b82f6': 'color-blue',
        '#eab308': 'color-yellow'
    };
    
    for (const hex in colors) {
        const btn = document.getElementById(colors[hex]);
        if (!btn) continue;
        if (hex === color) {
            btn.classList.add('ring-2');
            btn.classList.remove('ring-0');
        } else {
            btn.classList.add('ring-0');
            btn.classList.remove('ring-2');
        }
    }
}

function undoEditorStroke(e) {
    if (e) e.preventDefault();
    editorHistory.pop();
    redrawEditorCanvas();
}

function resetEditorDrawings(e) {
    if (e) e.preventDefault();
    if (confirm("Möchten Sie alle Markierungen von diesem Foto löschen?")) {
        editorHistory = [];
        redrawEditorCanvas();
    }
}

function savePhotoEditor(e) {
    if (e) e.preventDefault();
    if (!editorImage) return;
    
    const editedDataUrl = editorCanvas.toDataURL('image/jpeg', 0.8);
    
    if (editingImageIndex !== -1) {
        tempCompressedImages[editingImageIndex] = editedDataUrl;
        renderFormImagePreviews();
    }
    
    editorHistory = [];
    currentShape = null;
    isEditorDrawing = false;
    editingImageIndex = -1;
    closePhotoEditor();
}
