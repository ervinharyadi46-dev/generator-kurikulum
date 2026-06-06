require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ========================================
// 🔹 KONFIGURASI GEMINI (UPDATED TO 2.5)
// ========================================
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error('❌ GEMINI_API_KEY tidak ditemukan! Cek Environment Variables.');
    process.exit(1);
}

const MODEL_NAME = 'gemini-pro';
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: MODEL_NAME });
console.log(`📚 Model Aktif: ${MODEL_NAME}`);

// ========================================
// 🔹 FALLBACK FUNCTIONS
// ========================================
function fallbackTP(elemenNama, fase) {
    const verbs = ['memahami','menjelaskan','menganalisis','menerapkan','mengevaluasi'];
    return Array.from({length:5}, (_,i)=>({
        no: i+1,
        text: `Peserta didik mampu ${verbs[i]} konsep dasar ${elemenNama} sesuai level ${fase}.`
    }));
}

function fallbackRPM() {
    return {
        identifikasi: { murid: "<p>Karakteristik murid...</p>", lintas_disiplin: "<p>-</p>", topik: "<p>-</p>" },
        desain: { kemitraan: "<p>-</p>", lingkungan: "<p>-</p>", digital: "<p>-</p>" },
        pengalaman: { memahami: "<p>-</p>", mengaplikasi: "<p>-</p>", refleksi: "<p>-</p>" },
        asesmen: { awal: "<p>-</p>", proses: "<p>-</p>", akhir: "<p>-</p>" },
        lampiran: {
            materi: "<h3>A. Pendahuluan</h3><p>Materi belum berhasil dimuat.</p>",
            kisi_kisi: [{"no": 1, "tp": "TP 1", "indikator": "Indikator", "level": "L2", "nomor": "1"}],
            kunci: "<ol><li>Jawaban A</li></ol>",
            rubrik: "<table class='table-professional'><tr><th>Aspek</th><th>Skor 4</th><th>Skor 3</th><th>Skor 2</th><th>Skor 1</th></tr><tr><td>Pemahaman</td><td>Sangat Baik</td><td>Baik</td><td>Cukup</td><td>Kurang</td></tr></table>"
        }
    };
}

// ========================================
// 🔹 ENDPOINT ATP (BATCH)
// ========================================
app.post('/api/atp', async (req, res) => {
    try {
        const { identitas, elemenList } = req.body;
        if (!identitas || !elemenList?.length) {
            return res.status(400).json({ success: false, message: 'Data tidak lengkap' });
        }

        const daftarElemenTeks = elemenList.map((elem, idx) => `${idx + 1}. Elemen: ${elem.nama}\n   CP: ${elem.cp}`).join('\n\n');
        const prompt = `Ahli kurikulum Kurikulum Merdeka Indonesia. Buatkan Tujuan Pembelajaran (TP) dari data berikut:
Mapel: ${identitas.mapel} | Fase: ${identitas.fase}
${daftarElemenTeks}

Buat MINIMAL 5 TP per elemen. Output WAJIB JSON Array:
[{"elemenNama": "Nama Elemen", "tujuanPembelajaran": [{"no":1,"text":"Peserta didik mampu..."}]}]`;

        let result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.7, responseMimeType: "application/json" }
        });

        const raw = result.response.text();
        let aiJson = JSON.parse(raw);

        const hasil = elemenList.map(elem => {
            const match = Array.isArray(aiJson) && aiJson.find(item => item.elemenNama?.toLowerCase().trim() === elem.nama?.toLowerCase().trim());
            let tp = match ? match.tujuanPembelajaran : fallbackTP(elem.nama, identitas.fase);
            return { elemen: elem.nama, cp: elem.cp, pertemuan: elem.pertemuan, jp: elem.jp, tujuanPembelajaran: tp };
        });

        res.json({ success: true, data: hasil });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ========================================
// 🔹 ENDPOINT RPM (STRUKTUR HTML PROFESIONAL)
// ========================================
app.post('/api/rpm', async (req, res) => {
    try {
        const { identitas, praktikList, dimensiList } = req.body;
        if (!identitas || !praktikList?.length) {
            return res.status(400).json({ success: false, message: 'Data tidak lengkap' });
        }

        const prompt = `Anda ahli kurikulum Kurikulum Merdeka Indonesia. Buatkan RPM (Rencana Pembelajaran Mendalam) yang detail.

DATA INPUT:
- Satuan Pendidikan: ${identitas.sekolah}
- Mapel: ${identitas.mapel} | Kelas: ${identitas.kelas} | Fase: ${identitas.fase}
- CP: ${identitas.cp} | TP: ${identitas.tp} | Materi: ${identitas.materi}
- Pertemuan: ${identitas.jmlPertemuan} x ${identitas.durasi}
- Praktik Pedagogis: ${praktikList.join(', ')}
- Dimensi Lulusan: ${dimensiList.join(', ')}

OUTPUT WAJIB JSON MURNI DENGAN FORMAT STRUKTUR BERIKUT.
PENTING: Semua value teks penjelasan WAJIB menggunakan tag HTML (<p>, <ul>, <li>, <strong>) agar tampilannya terstruktur dan rapi saat dirender di web. JANGAN gunakan markdown (** atau -).

{
  "identifikasi": {
    "murid": "<p>Deskripsi karakteristik murid...</p>",
    "lintas_disiplin": "<p>Keterkaitan mapel lintas disiplin...</p>",
    "topik": "<p>Topik utama pembelajaran...</p>"
  },
  "desain": {
    "kemitraan": "<p>Rekomendasi kemitraan...</p>",
    "lingkungan": "<p>Pemanfaatan lingkungan belajar...</p>",
    "digital": "<p>Alat digital yang dipakai (Canva, Quizizz, dll)...</p>"
  },
  "pengalaman": {
    "memahami": "<p><strong>Kegiatan Awal:</strong> ...</p>",
    "mengaplikasi": "<p><strong>Kegiatan Inti:</strong> ...</p>",
    "refleksi": "<p><strong>Kegiatan Penutup:</strong> ...</p>"
  },
  "asesmen": {
    "awal": "<p>Metode asesmen diagnostik...</p>",
    "proses": "<p>Formatif / Observasi proses...</p>",
    "akhir": "<p>Sumatif / Produk akhir...</p>"
  },
  "lampiran": {
    "materi": "<h3>A. Pengertian [Topik]</h3><p>Penjelasan...</p><h3>B. Komponen Utama</h3><ul><li>Poin 1</li></ul>",
    "kisi_kisi": [{"no":1,"tp":"TP Terkait","indikator":"Indikator Soal","level":"L2","nomor":"1"}],
    "kunci": "<ol><li><strong>Jawaban: A</strong><br/>Pembahasan: ...</li></ol>",
    "rubrik": "<table class='table-professional'><thead><tr><th>Aspek Penilaian</th><th>Skor 4 (Sangat Baik)</th><th>Skor 3 (Baik)</th><th>Skor 2 (Cukup)</th><th>Skor 1 (Kurang)</th></tr></thead><tbody><tr><td><strong>Pemahaman Konsep</strong></td><td>Mampu menjelaskan secara komprehensif...</td><td>Mampu menjelaskan dengan baik...</td><td>Hanya memahami sebagian...</td><td>Belum mampu menjelaskan...</td></tr><tr><td><strong>Penerapan/Analisis</strong></td><td>Sangat akurat menganalisis...</td><td>Cukup akurat...</td><td>Kurang akurat...</td><td>Tidak mampu...</td></tr></tbody></table>"
  }
}`;

        let result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.7, responseMimeType: "application/json" }
        });

        const raw = result.response.text();
        let data = JSON.parse(raw);
        res.json({ success: true, data: data });

    } catch (e) {
        console.error('❌ RPM Error:', e.message);
        res.json({ success: true, data: fallbackRPM() }); // Gunakan fallback aman jika eror JSON
    }
});

app.get('/api/status', (req, res) => res.json({ status: 'ok', model: MODEL_NAME }));
app.get('/atp', (req, res) => res.sendFile(path.join(__dirname, 'public', 'atp', 'index.html')));
app.get('/rpm', (req, res) => res.sendFile(path.join(__dirname, 'public', 'rpm', 'index.html')));

if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`🚀 Server di http://localhost:${PORT}`));
}
// HAPUS/KOMENTARI ini:
// module.exports = app;

// TAMBAHKAN ini:
const PORT = process.env.PORT || 3001;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Server berjalan di: http://localhost:${PORT}`);
    console.log(`📚 Model: gemini-1.5-flash`);
    console.log(`✅ Endpoints: /api/atp, /api/rpm, /api/status\n`);
});