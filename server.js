// =============================
// ✅ Fuel Management Backend (Stable Version + Receipt Upload)
// =============================
const express = require('express');
const sql = require('mssql');
const bcrypt = require('bcrypt');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const port = 5000;

// --------------------
// Middleware
// --------------------
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --------------------
// Database Config
// --------------------
const config = {
  user: 'sa',
  password: 'Tarun@9887',
  server: 'localhost',
  database: 'PremMotors',
  options: { trustServerCertificate: true },
};

// DB Connection Helper
const getPool = async () => {
  try {
    const pool = await sql.connect(config);
    return pool;
  } catch (err) {
    console.error('❌ Database Connection Error:', err);
    throw err;
  }
};

// Check DB Connection on startup
(async () => {
  try {
    const pool = await getPool();
    if (pool.connected) console.log('✅ Connected to MSSQL Database');
  } catch (err) {
    console.error('❌ Database connection failed at startup:', err);
  }
})();

// ===================================================
// 📸 MULTER (Receipt Upload Config)
// ===================================================
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueName = `receipt_${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('❌ Only JPG, PNG, PDF allowed!'));
  },
});

app.use('/uploads', express.static(uploadDir));

// ===================================================
// 🧾 REGISTER USER
// ===================================================
app.post('/api/register', async (req, res) => {
  const { username, email, password, role } = req.body;
  if (!username || !email || !password || !role)
    return res.status(400).json({ success: false, message: 'All fields are required.' });

  try {
    const pool = await getPool();
    const existing = await pool.request()
      .input('username', sql.NVarChar, username)
      .input('email', sql.NVarChar, email)
      .query('SELECT * FROM AppUsers WHERE Username=@username OR Email=@email');

    if (existing.recordset.length > 0)
      return res.status(409).json({ success: false, message: 'Username or email already exists.' });

    const hash = await bcrypt.hash(password, 10);

    await pool.request()
      .input('username', sql.NVarChar, username)
      .input('email', sql.NVarChar, email)
      .input('password', sql.NVarChar, hash)
      .input('role', sql.NVarChar, role)
      .query(`
        INSERT INTO AppUsers (Username, Email, PasswordHash, Role, CreatedAt, IsActive)
        VALUES (@username, @email, @password, @role, GETDATE(), 1)
      `);

    res.status(201).json({ success: true, message: 'Registration successful.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error registering user.' });
  }
});

// ===================================================
// 🔐 LOGIN USER
// ===================================================
app.post('/api/login', async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role)
    return res.status(400).json({ success: false, message: 'All fields required.' });

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('username', sql.NVarChar, username)
      .input('role', sql.NVarChar, role)
      .query('SELECT * FROM AppUsers WHERE Username=@username AND Role=@role');

    if (result.recordset.length === 0)
      return res.status(401).json({ success: false, message: 'Invalid username or role.' });

    const user = result.recordset[0];
    const match = await bcrypt.compare(password, user.PasswordHash);

    if (!match)
      return res.status(401).json({ success: false, message: 'Incorrect password.' });

    res.json({
      success: true,
      userId: user.UserID,
      username: user.Username,
      role: user.Role,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Login error.' });
  }
});

// ===================================================
// 🚗 DRIVER — Add Fuel Request (with receipt)
// ===================================================
app.post('/api/fuel-entry', upload.single('receipt'), async (req, res) => {
  try {
    const { userId, vehicleName, vehicleNumber, odo, liters, rate, total, station, notes } = req.body;

    const pool = await getPool();

    const insertReq = await pool.request()
      .input('userId', sql.Int, userId)
      .input('vehicleName', sql.NVarChar, vehicleName)
      .input('vehicleNumber', sql.NVarChar, vehicleNumber)
      .input('odo', sql.NVarChar, odo)
      .input('liters', sql.Decimal(10, 2), liters)
      .input('rate', sql.Decimal(10, 2), rate)
      .input('total', sql.Decimal(10, 2), total)
      .input('station', sql.NVarChar, station)
      .input('notes', sql.NVarChar, notes || '')
      .query(`
        INSERT INTO FuelRequests (UserID, VehicleName, VehicleNumber, Odo, Liters, Rate, Total, Station, Notes, Status, CreatedAt)
        OUTPUT INSERTED.RequestID
        VALUES (@userId, @vehicleName, @vehicleNumber, @odo, @liters, @rate, @total, @station, @notes, 'Pending', GETDATE())
      `);

    const requestId = insertReq.recordset[0].RequestID;

    if (req.file) {
      const uploadedPath = `/uploads/${req.file.filename}`;

      await pool.request()
        .input('requestId', sql.Int, requestId)
        .input('userId', sql.Int, userId)
        .input('filePath', sql.NVarChar, uploadedPath)
        .input('fileType', sql.NVarChar, req.file.mimetype)
        .query(`
          INSERT INTO FuelReceipts (RequestID, UserID, FilePath, FileType, UploadDate)
          VALUES (@requestId, @userId, @filePath, @fileType, GETDATE())
        `);
    }

    res.status(201).json({ success: true, message: 'Fuel request submitted successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error submitting fuel entry.' });
  }
});

// ===================================================
// 🚗 DRIVER — VIEW OWN REQUESTS (Pending + Approved + Rejected)
// ===================================================
app.get('/api/fuel-requests/:userId', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('userId', sql.Int, req.params.userId)
      .query(`
        SELECT fr.*, r.FilePath AS ReceiptUrl
        FROM FuelRequests fr
        LEFT JOIN FuelReceipts r ON fr.RequestID = r.RequestID
        WHERE fr.UserID = @userId
        ORDER BY fr.CreatedAt DESC
      `);

    res.json({ success: true, data: result.recordset });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error fetching driver requests.' });
  }
});

// ===================================================
// 👨‍💼 MANAGER — View Pending Requests
// ===================================================
app.get('/api/manager/pending', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT fr.*, u.Username AS DriverName, r.FilePath AS ReceiptUrl
      FROM FuelRequests fr
      INNER JOIN AppUsers u ON fr.UserID=u.UserID
      LEFT JOIN FuelReceipts r ON fr.RequestID=r.RequestID
      WHERE fr.Status='Pending'
      ORDER BY fr.CreatedAt DESC
    `);

    res.json({ success: true, data: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching pending list.' });
  }
});

// ===================================================
// 👨‍💼 MANAGER — View History (Approved + Rejected)
// ===================================================
app.get('/api/manager/history', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT fr.*, u.Username AS DriverName, r.FilePath AS ReceiptUrl
      FROM FuelRequests fr
      INNER JOIN AppUsers u ON fr.UserID=u.UserID
      LEFT JOIN FuelReceipts r ON fr.RequestID=r.RequestID
      WHERE fr.Status IN ('Approved', 'Rejected')
      ORDER BY fr.CreatedAt DESC
    `);

    res.json({ success: true, data: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching history.' });
  }
});

// ===================================================
// 👨‍💼 MANAGER — Approve / Reject
// ===================================================
app.post('/api/manager/update-status', async (req, res) => {
  const { requestId, status } = req.body;
  try {
    const pool = await getPool();
    await pool.request()
      .input('requestId', sql.Int, requestId)
      .input('status', sql.NVarChar, status)
      .query('UPDATE FuelRequests SET Status=@status WHERE RequestID=@requestId');

    res.json({ success: true, message: `Request ${status} successfully.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error updating status.' });
  }
});

//______________ FINANCE________________//

app.get('/api/finance/expenses', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT fr.*, u.Username AS DriverName, r.FilePath AS ReceiptUrl
      FROM FuelRequests fr
      INNER JOIN AppUsers u ON fr.UserID = u.UserID
      LEFT JOIN FuelReceipts r ON fr.RequestID = r.RequestID
      WHERE fr.Status = 'Approved'
      ORDER BY fr.CreatedAt DESC
    `);

    res.json({ success: true, data: result.recordset });
  } catch (err) {
    console.error("Finance Expense Error:", err);
    res.status(500).json({ success: false, message: "Error fetching finance expenses." });
  }
});


app.get('/api/finance/summary', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        COUNT(*) AS TotalRequests,
        ISNULL(SUM(Liters), 0) AS TotalLiters,
        ISNULL(SUM(Total), 0) AS TotalAmount
      FROM FuelRequests
      WHERE Status = 'Approved'
    `);

    return res.json({
      success: true,
      data: result.recordset[0]
    });

  } catch (err) {
    console.error("Finance Summary Error:", err);
    return res.status(500).json({
      success: false,
      message: "Error fetching summary data."
    });
  }
});


// ===================================================
// 🚀 START SERVER
// ===================================================
app.listen(port, () => {
  console.log(`🚀 Server running → http://localhost:${port}`);
});
