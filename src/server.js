import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuid } from "uuid";
import { readDb, writeDb } from "./db.js";
import { authenticate, authorizeRole, signBootstrapToken, signToken, verifyBootstrapToken } from "./auth.js";

const app = express();
const PORT = process.env.PORT || 4000;
const ADMIN_GATE_PASSWORDS = new Set([
  "ilovemyparents",
  "iloveamptemarak",
  "ilovemesukoros#@123"
]);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDistPath = process.env.FRONTEND_DIST
  ? path.resolve(process.env.FRONTEND_DIST)
  : null;
const clientOrigins = (process.env.CLIENT_URL || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || clientOrigins.length === 0 || clientOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  }
}));
app.use(express.json());

app.get("/api/health", (_, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/register", async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(400).json({ message: "name, email, password and role are required" });
  }

  if (!["seller", "customer"].includes(role)) {
    return res.status(400).json({ message: "Role must be seller or customer" });
  }

  const db = await readDb();
  const exists = db.users.some((user) => user.email.toLowerCase() === String(email).toLowerCase());
  if (exists) {
    return res.status(409).json({ message: "Email already registered" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: uuid(),
    name,
    email: String(email).toLowerCase(),
    passwordHash,
    role,
    createdAt: new Date().toISOString()
  };

  db.users.push(user);
  await writeDb(db);

  const token = signToken({ id: user.id, role: user.role, name: user.name, email: user.email });
  return res.status(201).json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role }
  });
});


app.post("/api/admin/access", async (req, res) => {
  const { password } = req.body;
  if (!password || !ADMIN_GATE_PASSWORDS.has(String(password))) {
    return res.status(401).json({ message: "Invalid admin password" });
  }

  const bootstrapToken = signBootstrapToken({ scope: "admin-bootstrap" });
  return res.json({ bootstrapToken });
});

app.post("/api/admin/bootstrap/create", async (req, res) => {
  const { bootstrapToken, name, email, password } = req.body;
  if (!bootstrapToken || !name || !email || !password) {
    return res.status(400).json({ message: "bootstrapToken, name, email and password are required" });
  }

  try {
    const decoded = verifyBootstrapToken(bootstrapToken);
    if (decoded.scope !== "admin-bootstrap") {
      return res.status(401).json({ message: "Invalid bootstrap token scope" });
    }
  } catch {
    return res.status(401).json({ message: "Invalid or expired bootstrap token" });
  }

  const db = await readDb();
  const normalizedEmail = String(email).toLowerCase();
  const exists = db.users.some((user) => user.email === normalizedEmail);
  if (exists) {
    return res.status(409).json({ message: "Email already registered" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: uuid(),
    name,
    email: normalizedEmail,
    passwordHash,
    role: "admin",
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  await writeDb(db);

  const token = signToken({ id: user.id, role: user.role, name: user.name, email: user.email });
  return res.status(201).json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role }
  });
});
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "email and password are required" });
  }

  const db = await readDb();
  const user = db.users.find((u) => u.email === String(email).toLowerCase());

  if (!user) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const token = signToken({ id: user.id, role: user.role, name: user.name, email: user.email });
  return res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role }
  });
});

app.get("/api/vegetables", async (_, res) => {
  const db = await readDb();
  const sellers = new Map(db.users.filter((u) => u.role === "seller").map((u) => [u.id, u.name]));

  const vegetables = db.vegetables.map((veg) => ({
    ...veg,
    sellerName: sellers.get(veg.sellerId) || "Unknown Seller"
  }));

  return res.json(vegetables);
});

app.post("/api/vegetables", authenticate, authorizeRole("seller"), async (req, res) => {
  const { name, pricePerKg, quantityKg, description, imageUrl } = req.body;

  if (!name || pricePerKg == null || quantityKg == null) {
    return res.status(400).json({ message: "name, pricePerKg, quantityKg are required" });
  }

  const price = Number(pricePerKg);
  const quantity = Number(quantityKg);

  if (Number.isNaN(price) || Number.isNaN(quantity) || price <= 0 || quantity <= 0) {
    return res.status(400).json({ message: "pricePerKg and quantityKg must be positive numbers" });
  }

  const db = await readDb();
  const vegetable = {
    id: uuid(),
    sellerId: req.user.id,
    name,
    description: description || "",
    imageUrl: imageUrl || "",
    pricePerKg: price,
    quantityKg: quantity,
    createdAt: new Date().toISOString()
  };

  db.vegetables.push(vegetable);
  await writeDb(db);

  return res.status(201).json(vegetable);
});

app.get("/api/seller/vegetables", authenticate, authorizeRole("seller"), async (req, res) => {
  const db = await readDb();
  const mine = db.vegetables.filter((veg) => veg.sellerId === req.user.id);
  return res.json(mine);
});

app.put("/api/vegetables/:id", authenticate, authorizeRole("seller"), async (req, res) => {
  const { id } = req.params;
  const { name, pricePerKg, quantityKg, description, imageUrl } = req.body;
  const db = await readDb();
  const index = db.vegetables.findIndex((veg) => veg.id === id && veg.sellerId === req.user.id);

  if (index === -1) {
    return res.status(404).json({ message: "Vegetable not found" });
  }

  const price = Number(pricePerKg);
  const quantity = Number(quantityKg);
  if (!name || Number.isNaN(price) || Number.isNaN(quantity) || price <= 0 || quantity < 0) {
    return res.status(400).json({ message: "Invalid vegetable data" });
  }

  db.vegetables[index] = {
    ...db.vegetables[index],
    name,
    pricePerKg: price,
    quantityKg: quantity,
    description: description || "",
    imageUrl: imageUrl || ""
  };

  await writeDb(db);
  return res.json(db.vegetables[index]);
});

app.delete("/api/vegetables/:id", authenticate, authorizeRole("seller"), async (req, res) => {
  const { id } = req.params;
  const db = await readDb();
  const index = db.vegetables.findIndex((veg) => veg.id === id && veg.sellerId === req.user.id);

  if (index === -1) {
    return res.status(404).json({ message: "Vegetable not found" });
  }

  db.vegetables.splice(index, 1);
  await writeDb(db);
  return res.json({ message: "Vegetable deleted" });
});

app.post("/api/orders", authenticate, authorizeRole("customer"), async (req, res) => {
  const { items, deliveryAddress, phoneNumber } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "items must be a non-empty array" });
  }
  if (!deliveryAddress || !String(deliveryAddress).trim()) {
    return res.status(400).json({ message: "deliveryAddress is required" });
  }
  if (!phoneNumber || !String(phoneNumber).trim()) {
    return res.status(400).json({ message: "phoneNumber is required" });
  }

  const db = await readDb();

  let totalAmount = 0;
  const orderItems = [];

  for (const item of items) {
    const quantityKg = Number(item.quantityKg);
    if (!item.vegetableId || Number.isNaN(quantityKg) || quantityKg <= 0) {
      return res.status(400).json({ message: "Each item needs vegetableId and positive quantityKg" });
    }

    const vegetable = db.vegetables.find((veg) => veg.id === item.vegetableId);
    if (!vegetable) {
      return res.status(404).json({ message: `Vegetable not found: ${item.vegetableId}` });
    }

    if (vegetable.quantityKg < quantityKg) {
      return res.status(400).json({ message: `Not enough stock for ${vegetable.name}` });
    }

    const lineTotal = quantityKg * vegetable.pricePerKg;
    totalAmount += lineTotal;

    orderItems.push({
      vegetableId: vegetable.id,
      name: vegetable.name,
      imageUrl: vegetable.imageUrl || "",
      sellerId: vegetable.sellerId,
      pricePerKg: vegetable.pricePerKg,
      quantityKg,
      lineTotal
    });
  }

  for (const item of orderItems) {
    const veg = db.vegetables.find((v) => v.id === item.vegetableId);
    veg.quantityKg = Number((veg.quantityKg - item.quantityKg).toFixed(3));
  }

  const order = {
    id: uuid(),
    customerId: req.user.id,
    deliveryAddress: String(deliveryAddress).trim(),
    phoneNumber: String(phoneNumber).trim(),
    status: "placed",
    canceledAt: null,
    hiddenForCustomer: false,
    hiddenForSellers: [],
    items: orderItems,
    totalAmount: Number(totalAmount.toFixed(2)),
    createdAt: new Date().toISOString()
  };

  db.orders.push(order);
  await writeDb(db);

  return res.status(201).json(order);
});

app.get("/api/orders/me", authenticate, async (req, res) => {
  const db = await readDb();
  const byLatest = (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

  if (req.user.role === "customer") {
    const vegetablesById = new Map(db.vegetables.map((veg) => [veg.id, veg]));
    return res.json(
      db.orders
        .filter((order) => order.customerId === req.user.id && !order.hiddenForCustomer)
        .map((order) => ({
          ...order,
          items: order.items.map((item) => ({
            ...item,
            imageUrl: item.imageUrl || vegetablesById.get(item.vegetableId)?.imageUrl || ""
          }))
        }))
        .sort(byLatest)
    );
  }

  if (req.user.role === "seller") {
    const customers = new Map(db.users.filter((u) => u.role === "customer").map((u) => [u.id, u.name]));
    const related = db.orders
      .filter((order) => {
        const hiddenForSellers = Array.isArray(order.hiddenForSellers) ? order.hiddenForSellers : [];
        return order.items.some((item) => item.sellerId === req.user.id) && !hiddenForSellers.includes(req.user.id);
      })
      .map((order) => {
        const sellerItems = order.items.filter((item) => item.sellerId === req.user.id);
        const sellerAmount = sellerItems.reduce((sum, item) => sum + item.lineTotal, 0);
        return {
          ...order,
          customerName: customers.get(order.customerId) || "Unknown Customer",
          sellerItems,
          sellerAmount: Number(sellerAmount.toFixed(2))
        };
      });
    return res.json(related.sort(byLatest));
  }

  return res.json([]);
});

app.get("/api/admin/summary", authenticate, authorizeRole("admin"), async (_, res) => {
  const db = await readDb();
  const countsByRole = db.users.reduce((acc, user) => {
    acc[user.role] = (acc[user.role] || 0) + 1;
    return acc;
  }, {});
  const totalSales = db.orders
    .filter((order) => order.status !== "canceled")
    .reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);

  return res.json({
    users: db.users.length,
    sellers: countsByRole.seller || 0,
    customers: countsByRole.customer || 0,
    admins: countsByRole.admin || 0,
    vegetables: db.vegetables.length,
    orders: db.orders.length,
    placedOrders: db.orders.filter((order) => order.status !== "canceled").length,
    canceledOrders: db.orders.filter((order) => order.status === "canceled").length,
    totalSales: Number(totalSales.toFixed(2))
  });
});

app.get("/api/admin/users", authenticate, authorizeRole("admin"), async (_, res) => {
  const db = await readDb();
  const byLatest = (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  return res.json(
    db.users.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt
      }))
      .sort(byLatest)
  );
});

app.put("/api/admin/users/:id", authenticate, authorizeRole("admin"), async (req, res) => {
  const { id } = req.params;
  const { name, email, role, createdAt } = req.body;
  const db = await readDb();
  const index = db.users.findIndex((u) => u.id === id);

  if (index === -1) {
    return res.status(404).json({ message: "User not found" });
  }
  if (!name || !email || !role) {
    return res.status(400).json({ message: "name, email and role are required" });
  }
  if (!["seller", "customer", "admin"].includes(role)) {
    return res.status(400).json({ message: "Invalid role" });
  }

  const normalizedEmail = String(email).toLowerCase();
  const duplicate = db.users.some((u) => u.email === normalizedEmail && u.id !== id);
  if (duplicate) {
    return res.status(409).json({ message: "Email already in use" });
  }

  db.users[index] = {
    ...db.users[index],
    name,
    email: normalizedEmail,
    role,
    createdAt: createdAt || db.users[index].createdAt
  };
  await writeDb(db);
  return res.json({ message: "User updated" });
});

app.delete("/api/admin/users/:id", authenticate, authorizeRole("admin"), async (req, res) => {
  const { id } = req.params;
  const db = await readDb();
  const user = db.users.find((u) => u.id === id);
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }
  if (user.role === "admin") {
    const adminCount = db.users.filter((u) => u.role === "admin").length;
    if (adminCount <= 1) {
      return res.status(400).json({ message: "At least one admin must remain" });
    }
  }

  db.users = db.users.filter((u) => u.id !== id);
  if (user.role === "seller") {
    db.vegetables = db.vegetables.filter((veg) => veg.sellerId !== id);
    db.orders = db.orders
      .map((order) => {
        const items = order.items.filter((item) => item.sellerId !== id);
        if (items.length === 0) {
          return null;
        }
        const totalAmount = items.reduce((sum, item) => sum + item.lineTotal, 0);
        return { ...order, items, totalAmount: Number(totalAmount.toFixed(2)) };
      })
      .filter(Boolean);
  }
  if (user.role === "customer") {
    db.orders = db.orders.filter((order) => order.customerId !== id);
  }

  await writeDb(db);
  return res.json({ message: "User deleted" });
});

app.get("/api/admin/vegetables", authenticate, authorizeRole("admin"), async (_, res) => {
  const db = await readDb();
  const sellers = new Map(db.users.filter((u) => u.role === "seller").map((u) => [u.id, u.name]));
  const byLatest = (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  return res.json(
    db.vegetables.map((veg) => ({
      ...veg,
      sellerName: sellers.get(veg.sellerId) || "Unknown Seller"
    }))
      .sort(byLatest)
  );
});

app.put("/api/admin/vegetables/:id", authenticate, authorizeRole("admin"), async (req, res) => {
  const { id } = req.params;
  const { name, pricePerKg, quantityKg, description, imageUrl, sellerId, createdAt } = req.body;
  const db = await readDb();
  const index = db.vegetables.findIndex((veg) => veg.id === id);

  if (index === -1) {
    return res.status(404).json({ message: "Vegetable not found" });
  }

  const price = Number(pricePerKg);
  const quantity = Number(quantityKg);
  if (!name || Number.isNaN(price) || Number.isNaN(quantity) || price <= 0 || quantity < 0) {
    return res.status(400).json({ message: "Invalid vegetable data" });
  }
  if (sellerId) {
    const seller = db.users.find((u) => u.id === sellerId && u.role === "seller");
    if (!seller) {
      return res.status(400).json({ message: "Invalid sellerId" });
    }
  }

  db.vegetables[index] = {
    ...db.vegetables[index],
    name,
    pricePerKg: price,
    quantityKg: quantity,
    description: description || "",
    imageUrl: imageUrl || "",
    sellerId: sellerId || db.vegetables[index].sellerId,
    createdAt: createdAt || db.vegetables[index].createdAt
  };
  await writeDb(db);
  return res.json({ message: "Vegetable updated" });
});

app.delete("/api/admin/vegetables/:id", authenticate, authorizeRole("admin"), async (req, res) => {
  const { id } = req.params;
  const db = await readDb();
  const exists = db.vegetables.some((veg) => veg.id === id);
  if (!exists) {
    return res.status(404).json({ message: "Vegetable not found" });
  }
  db.vegetables = db.vegetables.filter((veg) => veg.id !== id);
  db.orders = db.orders
    .map((order) => {
      const items = order.items.filter((item) => item.vegetableId !== id);
      if (items.length === 0) {
        return null;
      }
      const totalAmount = items.reduce((sum, item) => sum + item.lineTotal, 0);
      return { ...order, items, totalAmount: Number(totalAmount.toFixed(2)) };
    })
    .filter(Boolean);

  await writeDb(db);
  return res.json({ message: "Vegetable deleted" });
});

app.get("/api/admin/orders", authenticate, authorizeRole("admin"), async (_, res) => {
  const db = await readDb();
  const customers = new Map(db.users.filter((u) => u.role === "customer").map((u) => [u.id, u.name]));
  const byLatest = (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  return res.json(
    db.orders.map((order) => ({
      ...order,
      customerName: customers.get(order.customerId) || "Unknown Customer"
    }))
      .sort(byLatest)
  );
});

app.put("/api/admin/orders/:id", authenticate, authorizeRole("admin"), async (req, res) => {
  const { id } = req.params;
  const { deliveryAddress, phoneNumber, status, totalAmount, customerId, createdAt, items } = req.body;
  const db = await readDb();
  const index = db.orders.findIndex((order) => order.id === id);

  if (index === -1) {
    return res.status(404).json({ message: "Order not found" });
  }
  if (!["placed", "canceled"].includes(status)) {
    return res.status(400).json({ message: "Invalid status" });
  }
  if (!deliveryAddress || !phoneNumber) {
    return res.status(400).json({ message: "deliveryAddress and phoneNumber are required" });
  }
  if (customerId) {
    const customer = db.users.find((u) => u.id === customerId && u.role === "customer");
    if (!customer) {
      return res.status(400).json({ message: "Invalid customerId" });
    }
  }
  const parsedTotal = Number(totalAmount);
  if (Number.isNaN(parsedTotal) || parsedTotal < 0) {
    return res.status(400).json({ message: "Invalid totalAmount" });
  }

  let nextItems = db.orders[index].items;
  if (Array.isArray(items)) {
    if (items.length === 0) {
      return res.status(400).json({ message: "items cannot be empty" });
    }
    nextItems = items.map((item) => ({
      vegetableId: item.vegetableId || "",
      name: item.name || "Unknown",
      imageUrl: item.imageUrl || "",
      sellerId: item.sellerId || "",
      pricePerKg: Number(item.pricePerKg || 0),
      quantityKg: Number(item.quantityKg || 0),
      lineTotal: Number(item.lineTotal || 0)
    }));
  }

  db.orders[index] = {
    ...db.orders[index],
    deliveryAddress: String(deliveryAddress).trim(),
    phoneNumber: String(phoneNumber).trim(),
    totalAmount: Number(parsedTotal.toFixed(2)),
    customerId: customerId || db.orders[index].customerId,
    createdAt: createdAt || db.orders[index].createdAt,
    items: nextItems,
    status,
    canceledAt: status === "canceled" ? (db.orders[index].canceledAt || new Date().toISOString()) : null
  };
  await writeDb(db);
  return res.json({ message: "Order updated" });
});

app.delete("/api/admin/orders/:id", authenticate, authorizeRole("admin"), async (req, res) => {
  const { id } = req.params;
  const db = await readDb();
  const exists = db.orders.some((order) => order.id === id);
  if (!exists) {
    return res.status(404).json({ message: "Order not found" });
  }
  db.orders = db.orders.filter((order) => order.id !== id);
  await writeDb(db);
  return res.json({ message: "Order deleted" });
});

app.delete("/api/orders/:orderId", authenticate, async (req, res) => {
  const { orderId } = req.params;
  const db = await readDb();
  const orderIndex = db.orders.findIndex((order) => order.id === orderId);

  if (orderIndex === -1) {
    return res.status(404).json({ message: "Order not found" });
  }

  const order = db.orders[orderIndex];

  if (req.user.role === "customer") {
    if (order.customerId !== req.user.id) {
      return res.status(403).json({ message: "You can only hide your own orders" });
    }
    db.orders[orderIndex] = {
      ...order,
      hiddenForCustomer: true
    };
    await writeDb(db);
    return res.json({ message: "Order hidden from customer page" });
  }

  if (req.user.role === "seller") {
    const sellerItems = order.items.filter((item) => item.sellerId === req.user.id);
    if (sellerItems.length === 0) {
      return res.status(403).json({ message: "You can only hide orders containing your vegetables" });
    }

    const hiddenForSellers = Array.isArray(order.hiddenForSellers) ? order.hiddenForSellers : [];
    if (!hiddenForSellers.includes(req.user.id)) {
      hiddenForSellers.push(req.user.id);
    }
    db.orders[orderIndex] = {
      ...order,
      hiddenForSellers
    };

    await writeDb(db);
    return res.json({ message: "Order hidden from seller page" });
  }

  return res.status(403).json({ message: "Forbidden" });
});

app.post("/api/orders/:orderId/cancel", authenticate, authorizeRole("customer"), async (req, res) => {
  const { orderId } = req.params;
  const db = await readDb();
  const orderIndex = db.orders.findIndex((order) => order.id === orderId);

  if (orderIndex === -1) {
    return res.status(404).json({ message: "Order not found" });
  }

  const order = db.orders[orderIndex];
  if (order.customerId !== req.user.id) {
    return res.status(403).json({ message: "You can only cancel your own orders" });
  }
  if (order.status === "canceled") {
    return res.status(400).json({ message: "Order already canceled" });
  }

  const createdAt = new Date(order.createdAt).getTime();
  const now = Date.now();
  const limitMs = 15 * 60 * 1000;
  if (Number.isNaN(createdAt) || now - createdAt > limitMs) {
    return res.status(400).json({ message: "Cancel is only allowed within 15 minutes of ordering" });
  }

  for (const item of order.items) {
    const vegetable = db.vegetables.find((veg) => veg.id === item.vegetableId);
    if (vegetable) {
      vegetable.quantityKg = Number((vegetable.quantityKg + item.quantityKg).toFixed(3));
    }
  }

  db.orders[orderIndex] = {
    ...order,
    status: "canceled",
    canceledAt: new Date().toISOString()
  };
  await writeDb(db);
  return res.json({ message: "Order canceled" });
});

if (NODE_ENV === "production" && frontendDistPath && fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) {
      return next();
    }
    return res.sendFile(path.join(frontendDistPath, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
