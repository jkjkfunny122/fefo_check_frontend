async function requestApi(url, options) {
    let response;
    try {
        response = await fetch(url, options);
    } catch (error) {
        throw new Error('เชื่อมต่อ API ไม่สำเร็จ กรุณาตรวจสอบว่าเซิร์ฟเวอร์กำลังทำงาน');
    }

    let data;
    try {
        data = await response.json();
    } catch (error) {
        throw new Error('เซิร์ฟเวอร์ส่งข้อมูลกลับมาในรูปแบบที่ไม่ถูกต้อง');
    }

    if (!response.ok) {
        throw new Error(data.error || `คำขอไม่สำเร็จ (${response.status})`);
    }
    return data;
}

function jsonOptions(method, body) {
    return {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    };
}

function getDaysUntilExpiry(expiryDate) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiryDate);
    if (!match) return Number.NaN;

    const expiry = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const today = new Date();
    const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    return Math.floor((expiry - todayUtc) / 86400000);
}

function getExpiryStatus(expiryDate) {
    const daysUntilExpiry = getDaysUntilExpiry(expiryDate);
    if (daysUntilExpiry < 0) {
        return { code: 'EXPIRED', label: 'หมดอายุแล้ว', badgeClass: 'bg-red-100 text-red-700' };
    }
    if (daysUntilExpiry <= 30) {
        return { code: 'NEAR_EXPIRY', label: 'ใกล้หมดอายุ', badgeClass: 'bg-amber-100 text-amber-800' };
    }
    return { code: 'SAFE', label: 'ปกติ', badgeClass: 'bg-emerald-100 text-emerald-700' };
}

function formatBoxAndPieces(quantity, itemsPerBox) {
    const boxSize = Number(itemsPerBox);
    const count = Number(quantity);
    if (!Number.isSafeInteger(boxSize) || boxSize <= 0 || !Number.isSafeInteger(count) || count < 0) {
        return `${quantity} ชิ้น`;
    }

    const boxes = Math.floor(count / boxSize);
    const pieces = count % boxSize;
    return boxes > 0 ? `${boxes} ลัง ${pieces} ชิ้น` : `${pieces} ชิ้น`;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    })[character]);
}

function showAppError(message) {
    let banner = document.getElementById('app-error');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'app-error';
        banner.className = 'mx-auto my-4 w-full max-w-7xl rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800';
        banner.setAttribute('role', 'alert');
        const main = document.querySelector('main');
        if (main && main.parentNode) {
            main.parentNode.insertBefore(banner, main);
        } else {
            document.body.prepend(banner);
        }
    }
    banner.textContent = message;
    banner.hidden = false;
}

function clearAppError() {
    const banner = document.getElementById('app-error');
    if (banner) banner.hidden = true;
}

function localDateString() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function renderPagination(containerId, currentPage, totalPages, onPageChange) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';
    if (totalPages <= 1) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden', 'justify-between');
    container.classList.add('flex', 'flex-wrap', 'items-center', 'justify-center', 'gap-2');

    const createButton = (text, page, label, active = false) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = active
            ? 'rounded-lg border border-indigo-600 bg-indigo-600 px-3 py-1.5 font-semibold text-white'
            : 'rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50';
        button.textContent = text;
        button.setAttribute('aria-label', label);
        if (active) button.setAttribute('aria-current', 'page');
        button.disabled = page < 1 || page > totalPages;
        button.addEventListener('click', () => onPageChange(page));
        return button;
    };

    container.appendChild(createButton('ก่อนหน้า', currentPage - 1, 'หน้าก่อนหน้า'));

    const firstPage = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
    const lastPage = Math.min(totalPages, firstPage + 4);
    for (let page = firstPage; page <= lastPage; page += 1) {
        container.appendChild(createButton(String(page), page, `ไปหน้าที่ ${page}`, page === currentPage));
    }

    container.appendChild(createButton('ถัดไป', currentPage + 1, 'หน้าถัดไป'));
}

window.InventoryAPI = {
    getLots: () => requestApi('/api/lots'),
    getLogs: () => requestApi('/api/logs'),
    getSellableProducts: () => requestApi('/api/sellable-products'),
    lookupProduct: (barcode) => requestApi(`/api/products/lookup/${encodeURIComponent(barcode)}`),
    searchProducts: (search, page = 1, limit = 10) => requestApi(
        `/api/products/search?search=${encodeURIComponent(search)}&page=${encodeURIComponent(page)}&limit=${encodeURIComponent(limit)}`,
    ),
    addNewLot: (lot) => requestApi('/api/lots', jsonOptions('POST', lot)),
    deleteLot: (id) => requestApi(`/api/lots/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    deductStock: (sale) => requestApi('/api/sales', jsonOptions('POST', sale)),
};

window.getExpiryStatus = getExpiryStatus;
window.getDaysUntilExpiry = getDaysUntilExpiry;
window.formatBoxAndPieces = formatBoxAndPieces;
window.escapeHtml = escapeHtml;
window.showAppError = showAppError;
window.clearAppError = clearAppError;
window.localDateString = localDateString;
window.renderPagination = renderPagination;
