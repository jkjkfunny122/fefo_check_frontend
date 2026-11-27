const mysql = require('mysql2/promise');

let pool;

function getPool() {
    const requiredSettings = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
    const missingSettings = requiredSettings.filter((setting) => !process.env[setting]?.trim());
    if (missingSettings.length > 0) {
        const error = new Error(`ตั้งค่าฐานข้อมูลไม่ครบ กรุณากำหนด ${missingSettings.join(', ')} ในไฟล์ .env`);
        error.status = 503;
        throw error;
    }

    const port = Number(process.env.DB_PORT || 3306);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        const error = new Error('DB_PORT ต้องเป็นหมายเลขพอร์ตที่ถูกต้อง');
        error.status = 503;
        throw error;
    }

    if (!pool) {
        pool = mysql.createPool({
            host: process.env.DB_HOST.trim(),
            port,
            user: process.env.DB_USER.trim(),
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME.trim(),
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            dateStrings: true,
            supportBigNumbers: true,
            bigNumberStrings: true,
        });
    }

    return pool;
}

async function withTransaction(callback) {
    const connection = await getPool().getConnection();

    try {
        await connection.beginTransaction();
        const result = await callback(connection);
        await connection.commit();
        return result;
    } catch (error) {
        try {
            await connection.rollback();
        } catch (rollbackError) {
            console.error('MySQL transaction rollback failed:', rollbackError);
        }
        throw error;
    } finally {
        connection.release();
    }
}

module.exports = { getPool, withTransaction };
