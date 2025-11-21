// server.js
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import { nanoid } from "nanoid";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static("public")); // phục vụ file tĩnh (index.html, css, js) trong thư mục /public

// --- Lưu trạng thái người dùng ---
const clients = new Map(); // ws -> { id, name }

function broadcast(data, exceptWs = null) {
	const msg = JSON.stringify(data);
	for (const ws of wss.clients) {
		if (ws.readyState === ws.OPEN && ws !== exceptWs) ws.send(msg);
	}
}

function send(ws, data) {
	if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
}

// --- Heartbeat để phát hiện client rớt kết nối ---
function heartbeat() {
	this.isAlive = true;
}

wss.on("connection", (ws) => {
	ws.isAlive = true;
	ws.on("pong", heartbeat);

	// Gán tạm ID cho client, tên sẽ cập nhật sau khi "join"
	const user = { id: nanoid(8), name: "Anonymous" };
	clients.set(ws, user);

	// Gửi danh sách online cho client mới
	send(ws, {
		type: "online",
		users: Array.from(clients.values()).map(({ id, name }) => ({
			id,
			name,
		})),
	});

	ws.on("message", (raw) => {
		let data;
		try {
			data = JSON.parse(raw);
		} catch {
			return;
		}

		// Các loại message: join, chat, typing
		if (data.type === "join") {
			user.name = String(data.name || "Anonymous").slice(0, 32);
			// thông báo mọi người
			broadcast(
				{ type: "system", text: `${user.name} đã tham gia` },
				null
			);
			// cập nhật danh sách online
			broadcast({
				type: "online",
				users: Array.from(clients.values()).map(({ id, name }) => ({
					id,
					name,
				})),
			});
			return;
		}

		if (data.type === "chat") {
			const payload = {
				type: "chat",
				from: { id: user.id, name: user.name },
				text: String(data.text ?? "").slice(0, 2000),
				ts: Date.now(),
			};
			broadcast(payload, null);
			return;
		}

		if (data.type === "typing") {
			broadcast(
				{ type: "typing", from: { id: user.id, name: user.name } },
				ws
			);
			return;
		}
	});

	ws.on("close", () => {
		const left = clients.get(ws);
		clients.delete(ws);
		if (left) {
			broadcast(
				{ type: "system", text: `${left.name} đã rời phòng` },
				null
			);
			broadcast({
				type: "online",
				users: Array.from(clients.values()).map(({ id, name }) => ({
					id,
					name,
				})),
			});
		}
	});
});

// Ping định kỳ
const interval = setInterval(() => {
	for (const ws of wss.clients) {
		if (ws.isAlive === false) return ws.terminate();
		ws.isAlive = false;
		ws.ping();
	}
}, 30000);

wss.on("close", () => clearInterval(interval));

// Khởi động
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
	console.log(`Chat server running at http://localhost:${PORT}`);
});
