require('dotenv').config();

const express = require('express');
const path = require('node:path');
const apiRouter = require('./server/api');

const app = express();
const publicDirectory = path.join(__dirname, 'public');
const port = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '100kb' }));
app.use('/api', apiRouter);
app.use(express.static(publicDirectory));

app.use((error, request, response, next) => {
    if (response.headersSent) {
        next(error);
        return;
    }

    if (error.code === 'ER_DUP_ENTRY') {
        response.status(409).json({ error: 'เลข Barcode หรือ Order ID นี้มีอยู่ในระบบแล้ว' });
        return;
    }

    if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ER_ACCESS_DENIED_ERROR'].includes(error.code)) {
        console.error('MySQL connection failed:', error);
        response.status(503).json({ error: 'เชื่อมต่อ MySQL ไม่สำเร็จ ตรวจสอบค่า .env และการเชื่อมต่อเครือข่าย' });
        return;
    }

    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) {
        console.error('Request failed:', error);
    }

    const message = status >= 500 && !error.status
        ? 'เกิดข้อผิดพลาดภายในระบบ'
        : error.message;
    response.status(status).json({ error: message });
});

app.listen(port, '127.0.0.1', () => {
    console.log(`เว็บไซต์พร้อมใช้งานที่ http://localhost:${port}`);
});
