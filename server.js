// =============================
// FUEL MANAGEMENT BACKEND (FINAL + NOTIFICATION READY)
// =============================
const express = require("express");
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// 🔥 FCM HELPER
const sendNotification = require("./sendNotification");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =============================
// UPLOADS FOLDER
// =============================
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
app.use("/uploads", express.static(uploadDir));

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) =>
    cb(null, `receipt_${Date.now()}${path.extname(file.originalname)}`),
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
  connectionLimit: 10,
});

// =============================
// ROOT
// =============================
app.get("/", (_, res) =>
  res.json({ message: "🚀 Fuel Management API is running successfully!" })
);

// =============================
// SAVE FCM TOKEN
// =============================
app.post("/api/save-token", async (req, res) => {
  const { userId, token } = req.body;

  if (!userId || !token)
    return res.json({ success: false, message: "userId & token required" });

  try {
    await pool.query(
      "UPDATE AppUsers SET FCMToken = ? WHERE UserID = ?",
      [token, userId]
    );

    res.json({ success: true, message: "Token saved" });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// =============================
// REGISTER
// =============================
app.post("/api/register", async (req, res) => {
  const { username, email, password, role } = req.body;

  if (!username || !email || !password || !role)
    return res
      .status(400)
      .json({ success: false, message: "All fields required" });

  try {
    const [exists] = await pool.query(
      "SELECT * FROM AppUsers WHERE Username = ? OR Email = ?",
      [username, email]
    );

    if (exists.length > 0)
      return res
        .status(409)
        .json({ success: false, message: "User already exists" });

    const hash = await bcrypt.hash(password, 10);

    await pool.query(
      "INSERT INTO AppUsers (Username, Email, PasswordHash, Role) VALUES (?, ?, ?, ?)",
      [username, email, hash, role]
    );

    res.json({ success: true, message: "Registration successful" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// =============================
// LOGIN
// =============================
app.post("/api/login", async (req, res) => {
  const { username, password, role } = req.body;

  try {
    const [rows] = await pool.query(
      "SELECT * FROM AppUsers WHERE Username=? AND Role=?",
      [username, role]
    );

    if (rows.length === 0)
      return res
        .status(401)
        .json({ success: false, message: "User not found" });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.PasswordHash);

    if (!match)
      return res
        .status(401)
        .json({ success: false, message: "Wrong password" });

    res.json({
      success: true,
      userId: user.UserID,
      username: user.Username,
      email: user.Email,
      role: user.Role,
      token: user.FCMToken,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// =============================
// GET PROFILE
// =============================
app.get("/api/get-user/:id", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT UserID, Username, Email, Role, FCMToken FROM AppUsers WHERE UserID = ?",
      [req.params.id]
    );

    if (rows.length === 0)
      return res.json({ success: false, message: "User not found" });

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// =============================
// FUEL ENTRY (Driver → Manager Notification)
// =============================
app.post("/api/fuel-entry", upload.single("receipt"), async (req, res) => {
  try {
    const { userId, vehicleName, vehicleNumber, odo, liters, rate, total, station, notes } =
      req.body;

    const [result] = await pool.query(
      `
        INSERT INTO FuelRequests 
        (UserID, VehicleName, VehicleNumber, Odo, Liters, Rate, Total, Station, Notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [userId, vehicleName, vehicleNumber, odo, liters, rate, total, station, notes]
    );

    const requestId = result.insertId;

    if (req.file) {
      await pool.query(
        `
          INSERT INTO FuelReceipts (RequestID, UserID, FilePath, FileType)
          VALUES (?, ?, ?, ?)
        `,
        [requestId, userId, `/uploads/${req.file.filename}`, req.file.mimetype]
      );
    }

    // 🔥 SEND NOTIFICATION TO MANAGER + save in DB
    const [managers] = await pool.query(
      "SELECT UserID, FCMToken FROM AppUsers WHERE Role = 'Manager'"
    );

    for (const manager of managers) {
      // Save notification in DB
      await pool.query(
        `INSERT INTO Notifications (UserID, Title, Message, IsRead)
         VALUES (?, ?, ?, 0)`,
        [manager.UserID, "New Fuel Request", "A driver submitted a fuel request"]
      );

      // Send FCM push
      if (manager.FCMToken) {
        sendNotification(
          manager.FCMToken,
          "New Fuel Request",
          "A driver submitted a fuel request",
          { requestId: String(requestId) }
        );
      }
    }

    res.json({ success: true, message: "Fuel request submitted" });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// =============================
// MANAGER — UPDATE STATUS (Manager → Driver Notification)
// =============================
app.post("/api/manager/update-status", async (req, res) => {
  try {
    const { requestId, status } = req.body;

    await pool.query(
      "UPDATE FuelRequests SET Status = ? WHERE RequestID = ?",
      [status, requestId]
    );

    // Get driver details
    const [[driver]] = await pool.query(
      `
      SELECT u.UserID, u.FCMToken 
      FROM FuelRequests fr
      JOIN AppUsers u ON fr.UserID = u.UserID
      WHERE fr.RequestID = ?
      `,
      [requestId]
    );

    if (driver) {
      // Save notification in DB
      await pool.query(
        `INSERT INTO Notifications (UserID, Title, Message, IsRead)
         VALUES (?, ?, ?, 0)`,
        [
          driver.UserID,
          `Request ${status}`,
          `Your fuel request has been ${status}.`,
        ]
      );

      // Send FCM push
      if (driver.FCMToken) {
        sendNotification(
          driver.FCMToken,
          `Request ${status}`,
          `Your fuel request has been ${status}.`,
          { requestId: String(requestId) }
        );
      }
    }

    res.json({ success: true, message: "Status updated successfully" });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// =============================
// FINANCE — EXPENSES & SUMMARY
// =============================
app.get("/api/finance/expenses", async (_, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT fr.*, u.Username AS DriverName,
      (SELECT FilePath FROM FuelReceipts WHERE RequestID = fr.RequestID LIMIT 1) AS ReceiptUrl
      FROM FuelRequests fr
      LEFT JOIN AppUsers u ON fr.UserID = u.UserID
      WHERE fr.Status = 'Approved'
      ORDER BY fr.RequestID DESC
    `);

    res.json({ success: true, data: rows });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

app.get("/api/finance/summary", async (_, res) => {
  try {
    const [[sum]] = await pool.query(`
      SELECT 
        COUNT(*) AS TotalRequests,
        SUM(Total) AS TotalAmount,
        SUM(Liters) AS TotalLiters
      FROM FuelRequests
    `);

    res.json({ success: true, data: sum });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// =============================
// START SERVER
// =============================
app.listen(PORT, () =>
  console.log(`🚀 Server Running on PORT ${PORT}`)
);
