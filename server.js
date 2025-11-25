// =============================
// FUEL MANAGEMENT BACKEND (FINAL CLEAN VERSION)
// =============================
const express = require("express");
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// 🔥 FCM Notification Helper
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

// Multer storage
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
// ROOT API
// =============================
app.get("/", (_, res) =>
  res.json({ message: "🚀 Fuel Management API Running Successfully!" })
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
// REGISTER USER
// =============================
app.post("/api/register", async (req, res) => {
  const { username, email, password, role } = req.body;

  if (!username || !email || !password || !role)
    return res.json({
      success: false,
      message: "All fields required",
    });

  try {
    const [exists] = await pool.query(
      "SELECT * FROM AppUsers WHERE Username=? OR Email=?",
      [username, email]
    );

    if (exists.length)
      return res.json({
        success: false,
        message: "User already exists",
      });

    const hash = await bcrypt.hash(password, 10);

    await pool.query(
      "INSERT INTO AppUsers (Username, Email, PasswordHash, Role) VALUES (?, ?, ?, ?)",
      [username, email, hash, role]
    );

    res.json({ success: true, message: "Registration successful" });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// =============================
// LOGIN USER
// =============================
app.post("/api/login", async (req, res) => {
  const { username, password, role } = req.body;

  try {
    const [rows] = await pool.query(
      "SELECT * FROM AppUsers WHERE Username=? AND Role=?",
      [username, role]
    );

    if (!rows.length)
      return res.json({ success: false, message: "User not found" });

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.PasswordHash);

    if (!valid)
      return res.json({ success: false, message: "Wrong password" });

    res.json({
      success: true,
      userId: user.UserID,
      username: user.Username,
      email: user.Email,
      role: user.Role,
      token: user.FCMToken,
    });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// =============================
// FUEL ENTRY → NOTIFY MANAGERS
// =============================
app.post("/api/fuel-entry", upload.single("receipt"), async (req, res) => {
  try {
    const {
      userId,
      vehicleName,
      vehicleNumber,
      odo,
      liters,
      rate,
      total,
      station,
      notes,
    } = req.body;

    const [result] = await pool.query(
      `
      INSERT INTO FuelRequests 
      (UserID, VehicleName, VehicleNumber, Odo, Liters, Rate, Total, Station, Notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        userId,
        vehicleName,
        vehicleNumber,
        odo,
        liters,
        rate,
        total,
        station,
        notes,
      ]
    );

    const requestId = result.insertId;

    // Save receipt file
    if (req.file) {
      await pool.query(
        `
      INSERT INTO FuelReceipts (RequestID, UserID, FilePath, FileType)
      VALUES (?, ?, ?, ?)
      `,
        [
          requestId,
          userId,
          `/uploads/${req.file.filename}`,
          req.file.mimetype,
        ]
      );
    }

    // Notify all managers
    const [managers] = await pool.query(
      "SELECT UserID, FCMToken FROM AppUsers WHERE Role = 'Manager'"
    );

    for (const m of managers) {
      await pool.query(
        `
        INSERT INTO Notifications (UserID, Title, Message, IsRead)
        VALUES (?, ?, ?, 0)
        `,
        [
          m.UserID,
          "New Fuel Request",
          "A driver submitted a fuel request",
        ]
      );

      if (m.FCMToken) {
        sendNotification(
          m.FCMToken,
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
// START SERVER
// =============================
app.listen(PORT, () =>
  console.log(`🚀 Server running on PORT ${PORT}`)
);
