// tinyUrlService.js
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { randomUUID } = require("crypto");

const DB_PATH = path.resolve(process.cwd(), "tinyurls.sqlite");
const TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS urls (
    id TEXT PRIMARY KEY,
    tiniURL TEXT NOT NULL
  )
`;

function openDbEnsuring() {
  const exists = fs.existsSync(DB_PATH);
  const db = new Database(DB_PATH);
  db.exec(TABLE_SQL); // creates table if missing (also covers first run)
  if (!exists) console.log("[tinyurl] created DB at", DB_PATH);
  return db;
}

export function getTinyUrl(url:string) {
  const db = openDbEnsuring();
  const id = randomUUID();
  db.prepare("INSERT INTO urls (id, tiniURL) VALUES (?, ?)").run(id, url);
  db.close();
  return id; // this is your tiny id (uuid4)
}

export function retrieveUrl(id:string) {
  if (!fs.existsSync(DB_PATH)) {
    console.warn("[tinyurl] DB file not found at", DB_PATH);
    return undefined;
  }
  const db = new Database(DB_PATH);
  const row = db.prepare("SELECT tiniURL FROM urls WHERE id = ?").get(id);
  db.close();
  if (!row) {
    console.warn("[tinyurl] id not found:", id);
    return undefined;
  }
  return row.tiniURL; // original URL
}

