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
// AUTO FIX FUNCTION
// =============================
async function autoFixTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS AppUsers (
        UserID INT AUTO_INCREMENT PRIMARY KEY,
        Username VARCHAR(100),
        Email VARCHAR(150),
        PasswordHash VARCHAR(255),
        Role VARCHAR(50),
        IsActive TINYINT DEFAULT 1,
        CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        LastLogin DATETIME NULL
      );
    `);
    console.log("✔ AppUsers table verified!");
  } catch (err) {
    console.error("❌ TABLE FIX ERROR:", err.message);
  }
}

// RUN AUTO FIX
autoFixTables();

// =============================
// ROOT ROUTE
// =============================
app.get("/", (req, res) => {
  res.send("🚀 Fuel Management API is running successfully!");
});

// =============================
// TEST DB
// =============================
app.get("/test-db", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT 1");
    res.send("MYSQL CONNECTED SUCCESSFULLY!");
  } catch (err) {
    res.status(500).send("DB ERROR: " + err.message);
  }
});

// =============================
// CREATE TABLES
// =============================
app.get("/create-tables", async (req, res) => {
  try {

    await pool.query(`
      CREATE TABLE IF NOT EXISTS AppUsers (
        UserID INT AUTO_INCREMENT PRIMARY KEY,
        Username VARCHAR(100),
        Email VARCHAR(150),
        PasswordHash VARCHAR(255),
        Role VARCHAR(50),
        IsActive TINYINT DEFAULT 1,
        CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        LastLogin DATETIME NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS FuelRequests (
        RequestID INT AUTO_INCREMENT PRIMARY KEY,
        UserID INT NOT NULL,
        VehicleName VARCHAR(150),
        VehicleNumber VARCHAR(100),
        Odo VARCHAR(50),
        Liters DECIMAL(10,2),
        Rate DECIMAL(10,2),
        Total DECIMAL(10,2),
        Station VARCHAR(150),
        Notes VARCHAR(255),
        Status VARCHAR(50) DEFAULT 'Pending',
        CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (UserID) REFERENCES AppUsers(UserID)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS FuelReceipts (
        ReceiptID INT AUTO_INCREMENT PRIMARY KEY,
        RequestID INT NOT NULL,
        UserID INT NOT NULL,
        FilePath VARCHAR(255),
        FileType VARCHAR(50),
        UploadDate DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (RequestID) REFERENCES FuelRequests(RequestID),
        FOREIGN KEY (UserID) REFERENCES AppUsers(UserID)
      );
    `);

    res.send("🎉 TABLES CREATED SUCCESSFULLY!");

  } catch (err) {
    res.status(500).send("TABLE ERROR: " + err.message);
  }
});

// =============================
// DELETE ALL TABLES
// =============================
app.get("/delete-tables", async (req, res) => {
  try {
    await pool.query("SET FOREIGN_KEY_CHECKS = 0;");
    await pool.query("DROP TABLE IF EXISTS FuelReceipts;");
    await pool.query("DROP TABLE IF EXISTS FuelRequests;");
    await pool.query("DROP TABLE IF EXISTS AppUsers;");
    await pool.query("SET FOREIGN_KEY_CHECKS = 1;");
    res.send("🗑️ All tables deleted successfully!");
  } catch (err) {
    res.status(500).send("ERROR deleting tables: " + err.message);
  }
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
      role: user.Role
    });

  } catch (err) {
    res.status(500).json({ success: false, message: "Login error" });
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
// START SERVER
// =============================
app.listen(PORT, () => {
  console.log(`🚀 Server Running on PORT ${PORT}`);
});
