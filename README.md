# Drakzx Web — Server Version (Zero Dependency)

Website + server backend jadi 1 paket. Server ini nge-serve halaman web-nya SEKALIGUS nyediain API (login, projects, voting, upload file) yang datanya beneran tersimpan permanen di server dan sama buat semua orang, dari device manapun.

**Zero dependency** — cuma pakai fitur bawaan Node.js, nggak butuh `npm install` sama sekali. Tinggal `node server.js` langsung jalan.

## Login Owner

- Username: `Drakzx`
- Password: `Owner1!!`

## Cara jalanin

### Di laptop/komputer (perlu Node.js, download di nodejs.org)

```
node server.js
```

Buka browser ke `http://localhost:3000`

### Di Termux (Android)

```
pkg install nodejs
cd drakzx-server
node server.js
```

### Di Replit / Railway / Render

1. Upload semua isi folder ini
2. Set start command: `node server.js`
3. Run — dapet link publik otomatis

## Struktur file

```
server.js          <- server (API + serve halaman web), ZERO dependency
package.json         <- cuma metadata, ga ada dependency
public/index.html     <- halaman web-nya
data/data.json         <- database sederhana (auto-dibuat pas server pertama jalan)
uploads/                <- file ZIP yang di-upload owner (di-generate manual, tanpa library)
```

## Catatan penting

- **Data project & voting permanen** di `data/data.json` — restart server nggak bikin data ilang.
- **Sesi login (token)** reset kalau server restart — owner perlu login ulang, tapi data project/voting tetap aman.
- Ganti password owner: edit `OWNER_PASSWORD` di baris atas `server.js`.
- Batas upload file per project: 20MB total.
- Fitur ZIP upload ditulis manual (implementasi format ZIP dari nol) supaya tetap zero-dependency — support semua tipe file.
