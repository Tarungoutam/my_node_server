// =============================
// FUEL MANAGEMENT BACKEND (MYSQL VERSION)
// =============================
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

// MIDDLEWARE
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =============================
// UPLOAD DIRECTORY
// =============================
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
app.use('/uploads', express.static(uploadDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = `receipt_${Date.now()}${path.extname(file.originalname)}`;
    cb(null, unique);
  }
});
const upload = multer({ storage });

// =============================
// MYSQL CONNECTION
// =============================
const pool = mysql.createPool({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT,
  connectionLimit: 10
});

// =============================
// ROOT ROUTE
// =============================
app.get("/", (req, res) => {
  res.json({ message: "🚀 Fuel Management API is running successfully!" });
});

// =============================
// REGISTER
// =============================
app.post('/api/register', async (req, res) => {
  const { username, email, password, role } = req.body;

  if (!username || !email || !password || !role)
    return res.status(400).json({ success: false, message: "All fields required" });

  try {
    const [exists] = await pool.query(
      "SELECT * FROM AppUsers WHERE Username = ? OR Email = ?",
      [username, email]
    );

    if (exists.length > 0)
      return res.status(409).json({ success: false, message: "User already exists" });

    const hash = await bcrypt.hash(password, 10);

    await pool.query(
      "INSERT INTO AppUsers (Username, Email, PasswordHash, Role) VALUES (?, ?, ?, ?)",
      [username, email, hash, role]
    );

    res.json({ success: true, message: "Registration successful" });

  } catch (err) {
    res.status(500).json({ success: false, message: "Error: " + err.message });
  }
});

// =============================
// LOGIN
// =============================
app.post('/api/login', async (req, res) => {
  const { username, password, role } = req.body;

  try {
    const [rows] = await pool.query(
      "SELECT * FROM AppUsers WHERE Username=? AND Role=?",
      [username, role]
    );

    if (rows.length === 0)
      return res.status(401).json({ success: false, message: "User not found" });

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.PasswordHash);

    if (!ok)
      return res.status(401).json({ success: false, message: "Wrong password" });

    res.json({
      success: true,
      userId: user.UserID,
      username: user.Username,
      email: user.Email,
      role: user.Role
    });

  } catch (err) {
    res.status(500).json({ success: false, message: "Login error" });
  }
});

// =============================
// GET USER PROFILE
// =============================
app.get('/api/get-user/:id', async (req, res) => {
  const userId = req.params.id;

  try {
    const [rows] = await pool.query(
      "SELECT UserID, Username, Email, Role FROM AppUsers WHERE UserID = ?",
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    res.json({
      success: true,
      data: rows[0]
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Error: " + err.message
    });
  }
});

// =============================
// FUEL ENTRY WITH RECEIPT
// =============================
app.post('/api/fuel-entry', upload.single('receipt'), async (req, res) => {
  try {

    const { userId, vehicleName, vehicleNumber, odo, liters, rate, total, station, notes } = req.body;

    const [result] = await pool.query(`
      INSERT INTO FuelRequests (UserID, VehicleName, VehicleNumber, Odo, Liters, Rate, Total, Station, Notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [userId, vehicleName, vehicleNumber, odo, liters, rate, total, station, notes]);

    const requestId = result.insertId;

    // SAVE RECEIPT
    if (req.file) {
      await pool.query(`
        INSERT INTO FuelReceipts (RequestID, UserID, FilePath, FileType)
        VALUES (?, ?, ?, ?)
      `, [requestId, userId, `/uploads/${req.file.filename}`, req.file.mimetype]);
    }

    res.json({ success: true, message: "Fuel request submitted" });

  } catch (err) {
    res.status(500).json({ success: false, message: "Error: " + err.message });
  }
});

// =============================
// DRIVER — GET ALL OWN REQUESTS
// =============================
app.get('/api/driver/requests/:userId', async (req, res) => {
  const userId = req.params.userId;

  try {
    const [rows] = await pool.query(`
      SELECT 
        fr.*,
        (SELECT FilePath FROM FuelReceipts WHERE RequestID = fr.RequestID LIMIT 1) AS ReceiptUrl
      FROM FuelRequests fr
      WHERE fr.UserID = ?
      ORDER BY fr.RequestID DESC
    `, [userId]);

    res.json({
      success: true,
      data: rows
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// =============================
// MANAGER — GET ALL FUEL REQUESTS
// =============================
app.get('/api/manager/requests', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        fr.*, 
        u.Username,
        (SELECT FilePath FROM FuelReceipts WHERE RequestID = fr.RequestID LIMIT 1) AS ReceiptUrl
      FROM FuelRequests fr
      LEFT JOIN AppUsers u ON fr.UserID = u.UserID
      ORDER BY fr.RequestID DESC
    `);

    res.json({
      success: true,
      data: rows
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Error: " + err.message
    });
  }
});

// =============================
// START SERVER
// =============================
app.listen(PORT, () => {
  console.log(`🚀 Server Running on PORT ${PORT}`);
});
