const express = require('express');
const { getPool, withTransaction } = require('./database');

const router = express.Router();

class ApiError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function requireText(value, field, maxLength) {
    if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > maxLength) {
        throw new ApiError(400, `${field} ไม่ถูกต้อง`);
    }
    return value.trim();
}

function requirePositiveInteger(value, field) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new ApiError(400, `${field} ต้องเป็นจำนวนเต็มมากกว่า 0`);
    }
    return parsed;
}

function requireDate(value, field) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new ApiError(400, `${field} ต้องอยู่ในรูปแบบ YYYY-MM-DD`);
    }

    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        throw new ApiError(400, `${field} ไม่ใช่วันที่ที่ถูกต้อง`);
    }
    return value;
}

function toSafeNumber(value, field) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
        throw new Error(`Database value for ${field} exceeds the safe integer range`);
    }
    return parsed;
}

function toLotDto(row) {
    return {
        id: toSafeNumber(row.lot_id, 'lot_id'),
        barcode: row.barcode,
        name: row.product_name,
        receiveDate: row.receive_date,
        expiryDate: row.expiry_date,
        boxes: toSafeNumber(row.boxes, 'boxes'),
        itemsPerBox: toSafeNumber(row.items_per_box, 'items_per_box'),
        totalQty: toSafeNumber(row.received_qty, 'received_qty'),
        remainingQty: toSafeNumber(row.remaining_qty, 'remaining_qty'),
    };
}

router.get('/health', async (request, response) => {
    await getPool().query('SELECT 1');
    response.json({ status: 'ok', database: 'connected' });
});

router.get('/lots', async (request, response) => {
    const [rows] = await getPool().execute(`
        SELECT l.lot_id, p.barcode, p.product_name, l.receive_date, l.expiry_date,
               l.boxes, l.items_per_box, l.received_qty, l.remaining_qty
        FROM stock_lots AS l
        INNER JOIN products AS p ON p.product_id = l.product_id
        ORDER BY l.receive_date DESC, l.lot_id DESC
    `);
    response.json(rows.map(toLotDto));
});

router.get('/products/lookup/:barcode', async (request, response) => {
    const barcode = requireText(request.params.barcode, 'Barcode', 64);
    const [rows] = await getPool().execute(`
        SELECT barcode, product_name, items_per_box
        FROM products
        WHERE barcode = ? AND is_active = TRUE
        LIMIT 1
    `, [barcode]);

    if (rows.length === 0) {
        response.json(null);
        return;
    }

    response.json({
        barcode: rows[0].barcode,
        name: rows[0].product_name,
        itemsPerBox: toSafeNumber(rows[0].items_per_box, 'items_per_box'),
    });
});

router.post('/lots', async (request, response) => {
    const body = request.body || {};
    const barcode = requireText(body.barcode, 'Barcode', 64);
    const name = requireText(body.name, 'ชื่อสินค้า', 255);
    const receiveDate = requireDate(body.receiveDate, 'วันที่รับเข้า');
    const expiryDate = requireDate(body.expiryDate, 'วันหมดอายุ');
    const boxes = requirePositiveInteger(body.boxes, 'จำนวนลัง');
    const itemsPerBox = requirePositiveInteger(body.itemsPerBox, 'จำนวนชิ้นต่อลัง');
    const totalQty = boxes * itemsPerBox;

    if (boxes > 4294967295 || itemsPerBox > 4294967295 || !Number.isSafeInteger(totalQty)) {
        throw new ApiError(400, 'จำนวนสินค้ามากเกินกว่าที่ระบบรองรับ');
    }

    const lotId = await withTransaction(async (connection) => {
        const [products] = await connection.execute(
            'SELECT product_id FROM products WHERE barcode = ? FOR UPDATE',
            [barcode],
        );

        let productId;
        if (products.length > 0) {
            productId = products[0].product_id;
            await connection.execute(`
                UPDATE products
                SET product_name = ?, items_per_box = ?, is_active = TRUE
                WHERE product_id = ?
            `, [name, itemsPerBox, productId]);
        } else {
            const [productResult] = await connection.execute(`
                INSERT INTO products (barcode, product_name, items_per_box)
                VALUES (?, ?, ?)
            `, [barcode, name, itemsPerBox]);
            productId = productResult.insertId;
        }

        const [lotResult] = await connection.execute(`
            INSERT INTO stock_lots
                (product_id, receive_date, expiry_date, boxes, items_per_box, remaining_qty)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [productId, receiveDate, expiryDate, boxes, itemsPerBox, totalQty]);

        await connection.execute(`
            INSERT INTO stock_movements (lot_id, movement_type, quantity_change, note)
            VALUES (?, 'RECEIVE', ?, 'รับสินค้าเข้าคลัง')
        `, [lotResult.insertId, totalQty]);

        return lotResult.insertId;
    });

    response.status(201).json({ id: toSafeNumber(lotId, 'lot_id'), message: 'บันทึกรับสินค้าเรียบร้อยแล้ว' });
});

router.delete('/lots/:lotId', async (request, response) => {
    const lotId = requirePositiveInteger(request.params.lotId, 'Lot ID');

    await withTransaction(async (connection) => {
        const [lots] = await connection.execute(
            'SELECT lot_id FROM stock_lots WHERE lot_id = ? FOR UPDATE',
            [lotId],
        );
        if (lots.length === 0) {
            throw new ApiError(404, 'ไม่พบ Lot ที่ต้องการลบ');
        }

        const [sales] = await connection.execute(`
            SELECT COUNT(*) AS sale_count
            FROM stock_movements
            WHERE lot_id = ? AND movement_type = 'SALE'
        `, [lotId]);
        if (toSafeNumber(sales[0].sale_count, 'sale_count') > 0) {
            throw new ApiError(409, 'Lot นี้มีประวัติการขายแล้ว จึงไม่สามารถลบได้');
        }

        await connection.execute('DELETE FROM stock_movements WHERE lot_id = ?', [lotId]);
        await connection.execute('DELETE FROM stock_lots WHERE lot_id = ?', [lotId]);
    });

    response.json({ message: 'ลบ Lot เรียบร้อยแล้ว' });
});

router.get('/sellable-products', async (request, response) => {
    const [rows] = await getPool().execute(`
        SELECT p.barcode, p.product_name, SUM(l.remaining_qty) AS available_qty,
               MIN(l.expiry_date) AS nearest_expiry
        FROM products AS p
        INNER JOIN stock_lots AS l ON l.product_id = p.product_id
        WHERE p.is_active = TRUE
          AND l.remaining_qty > 0
          AND l.expiry_date >= CURRENT_DATE
        GROUP BY p.product_id, p.barcode, p.product_name
        ORDER BY p.product_name, p.barcode
    `);

    response.json(rows.map((row) => ({
        barcode: row.barcode,
        name: row.product_name,
        availableQty: toSafeNumber(row.available_qty, 'available_qty'),
        nearestExpiry: row.nearest_expiry,
    })));
});

router.get('/logs', async (request, response) => {
    const [rows] = await getPool().execute(`
        SELECT so.external_order_id AS order_id, so.source,
               DATE_FORMAT(so.created_at, '%Y-%m-%d %H:%i:%s') AS timestamp,
               soi.product_name_snapshot AS product_name,
               l.expiry_date, -sm.quantity_change AS deducted_qty,
               l.remaining_qty AS remaining_in_lot
        FROM (
            SELECT sales_order_id, external_order_id, source, created_at
            FROM sales_orders
            WHERE status = 'COMPLETED'
            ORDER BY created_at DESC, sales_order_id DESC
            LIMIT 8
        ) AS so
        INNER JOIN sales_order_items AS soi ON soi.sales_order_id = so.sales_order_id
        INNER JOIN stock_movements AS sm ON sm.sales_order_item_id = soi.sales_order_item_id
        INNER JOIN stock_lots AS l ON l.lot_id = sm.lot_id
        WHERE sm.movement_type = 'SALE'
        ORDER BY so.created_at DESC, sm.stock_movement_id
    `);

    const orders = new Map();
    for (const row of rows) {
        if (!orders.has(row.order_id)) {
            orders.set(row.order_id, {
                order_id: row.order_id,
                source: row.source,
                timestamp: row.timestamp,
                details: [],
            });
        }
        orders.get(row.order_id).details.push({
            product_name: row.product_name,
            expiry_date: row.expiry_date,
            deducted_qty: toSafeNumber(row.deducted_qty, 'deducted_qty'),
            remaining_in_lot: toSafeNumber(row.remaining_in_lot, 'remaining_in_lot'),
        });
    }

    response.json(Array.from(orders.values()));
});

router.post('/sales', async (request, response) => {
    const body = request.body || {};
    const orderId = requireText(body.order_id, 'Order ID', 100);
    const source = requireText(body.source || 'POS', 'Source', 50);

    if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 100) {
        throw new ApiError(400, 'รายการสินค้าต้องมีตั้งแต่ 1 ถึง 100 รายการ');
    }

    const itemsByBarcode = new Map();
    for (const item of body.items) {
        const barcode = requireText(item?.barcode, 'Barcode', 64);
        const quantity = requirePositiveInteger(item?.qty, 'จำนวนสินค้า');
        const total = (itemsByBarcode.get(barcode) || 0) + quantity;
        if (!Number.isSafeInteger(total)) {
            throw new ApiError(400, 'จำนวนสินค้าเกินกว่าที่ระบบรองรับ');
        }
        itemsByBarcode.set(barcode, total);
    }

    const items = Array.from(itemsByBarcode, ([barcode, quantity]) => ({ barcode, quantity }))
        .sort((left, right) => left.barcode.localeCompare(right.barcode));

    const deductedLots = await withTransaction(async (connection) => {
        const [orderResult] = await connection.execute(`
            INSERT INTO sales_orders (external_order_id, source, status)
            VALUES (?, ?, 'COMPLETED')
        `, [orderId, source]);
        const salesOrderId = orderResult.insertId;
        const deductions = [];

        for (const item of items) {
            const [products] = await connection.execute(`
                SELECT product_id, barcode, product_name
                FROM products
                WHERE barcode = ? AND is_active = TRUE
                LIMIT 1
            `, [item.barcode]);
            if (products.length === 0) {
                throw new ApiError(404, `ไม่พบสินค้า Barcode ${item.barcode}`);
            }

            const product = products[0];
            const [itemResult] = await connection.execute(`
                INSERT INTO sales_order_items
                    (sales_order_id, product_id, barcode_snapshot, product_name_snapshot, quantity)
                VALUES (?, ?, ?, ?, ?)
            `, [salesOrderId, product.product_id, product.barcode, product.product_name, item.quantity]);

            const [lots] = await connection.execute(`
                SELECT lot_id, expiry_date, remaining_qty
                FROM stock_lots
                WHERE product_id = ?
                  AND remaining_qty > 0
                  AND expiry_date >= CURRENT_DATE
                ORDER BY expiry_date ASC, lot_id ASC
                FOR UPDATE
            `, [product.product_id]);

            const availableQty = lots.reduce(
                (total, lot) => total + toSafeNumber(lot.remaining_qty, 'remaining_qty'),
                0,
            );
            if (availableQty < item.quantity) {
                throw new ApiError(409, `สินค้า ${product.product_name} มีไม่พอขาย (พร้อมขาย ${availableQty} ชิ้น)`);
            }

            let quantityToDeduct = item.quantity;
            for (const lot of lots) {
                if (quantityToDeduct === 0) break;

                const lotQty = toSafeNumber(lot.remaining_qty, 'remaining_qty');
                const deductedQty = Math.min(lotQty, quantityToDeduct);
                const remainingInLot = lotQty - deductedQty;

                await connection.execute(
                    'UPDATE stock_lots SET remaining_qty = ? WHERE lot_id = ?',
                    [remainingInLot, lot.lot_id],
                );
                await connection.execute(`
                    INSERT INTO stock_movements
                        (lot_id, sales_order_item_id, movement_type, quantity_change)
                    VALUES (?, ?, 'SALE', ?)
                `, [lot.lot_id, itemResult.insertId, -deductedQty]);

                deductions.push({
                    product_name: product.product_name,
                    expiry_date: lot.expiry_date,
                    deducted_qty: deductedQty,
                    remaining_in_lot: remainingInLot,
                });
                quantityToDeduct -= deductedQty;
            }
        }

        return deductions;
    });

    response.status(201).json({
        success: true,
        message: 'ตัดสต็อกสำเร็จ',
        order_id: orderId,
        deducted_lots: deductedLots,
    });
});

router.use((request, response) => {
    response.status(404).json({ error: 'ไม่พบ API ที่เรียกใช้งาน' });
});

module.exports = router;
