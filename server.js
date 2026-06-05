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
// 🔹 KONFIGURASI GEMINI
// ========================================
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error('❌ GEMINI_API_KEY tidak ditemukan! Cek file .env kamu.');
    process.exit(1);
}
console.log('🔑 API Key terdeteksi');

// Menggunakan model Gemini 2.5 Flash yang terbukti sukses di ATP
const MODEL_NAME = 'gemini-2.5-flash';
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: MODEL_NAME });
console.log(`📚 Model: ${MODEL_NAME}`);

// ========================================
// 🔹 ENDPOINT ATP
// ========================================
app.post('/api/atp', async (req, res) => {
    try {
        const { identitas, elemenList } = req.body;
        if (!identitas || !elemenList?.length) {
            return res.status(400).json({ success: false, message: 'Data tidak lengkap' });
        }

        const hasil = [];
        for (const elem of elemenList) {
            const prompt = `Ahli kurikulum Kurikulum Merdeka. Buatkan Tujuan Pembelajaran (TP) dari:
Mapel: ${identitas.mapel} | Fase: ${identitas.fase}
Elemen: ${elem.nama} | CP: ${elem.cp}
Buat MINIMAL 5 TP. Output HANYA JSON Array dengan struktur: [{"no":1,"text":"..."}]`;

            let attempts = 0, result, lastError;
            while (attempts < 3) {
                try { 
                    result = await model.generateContent({
                        contents: [{ role: 'user', parts: [{ text: prompt }] }],
                        generationConfig: { 
                            temperature: 0.7, 
                            maxOutputTokens: 8192,
                            responseMimeType: "application/json"
                        }
                    });
                    break; 
                }
                catch (err) { 
                    lastError = err;
                    attempts++; 
                    console.error(`[ATP] Percobaan ${attempts} gagal:`, err.message);
                    await new Promise(r => setTimeout(r, 2000 * attempts)); 
                }
            }
            if (!result) throw new Error(`AI error: ${lastError?.message || 'Gagal merespons'}`);

            const raw = result.response.text();
            let tp;
            try {
                tp = JSON.parse(raw);
                if (!Array.isArray(tp) || tp.length < 5) tp = fallbackTP(elem.nama, identitas.fase);
            } catch (parseError) {
                console.error('[ATP] Gagal baca JSON dari AI, menggunakan teks cadangan.');
                tp = fallbackTP(elem.nama, identitas.fase);
            }

            hasil.push({ elemen: elem.nama, cp: elem.cp, pertemuan: elem.pertemuan, jp: elem.jp, tujuanPembelajaran: tp });
            if (elemenList.indexOf(elem) < elemenList.length - 1) await new Promise(r => setTimeout(r, 1500));
        }
        res.json({ success: true, data: hasil });
    } catch (e) {
        console.error('❌ ATP Error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ========================================
// 🔹 ENDPOINT RPM (SUDAH DIOPTIMALKAN BIAR RAPI)
// ========================================
app.post('/api/rpm', async (req, res) => {
    try {
        const { identitas, praktikList, dimensiList } = req.body;
        if (!identitas || !praktikList?.length) {
            return res.status(400).json({ success: false, message: 'Data tidak lengkap' });
        }

        const prompt = `Anda ahli kurikulum Kurikulum Merdeka Indonesia. Buatkan RPM (Rencana Pembelajaran Mendalam).

DATA INPUT:
- Satuan Pendidikan: ${identitas.sekolah}
- Mapel: ${identitas.mapel} | Kelas: ${identitas.kelas} | Fase: ${identitas.fase}
- CP: ${identitas.cp}
- TP: ${identitas.tp}
- Materi: ${identitas.materi}
- Pertemuan: ${identitas.jmlPertemuan} x ${identitas.durasi}
- Praktik Pedagogis: ${praktikList.join(', ')}
- Dimensi Lulusan: ${dimensiList.join(', ')}

OUTPUT HANYA JSON murni dengan struktur PERSIS ini:
{
  "identifikasi": {
    "murid": "Deskripsi karakteristik murid...",
    "lintas_disiplin": "Mapel lain yang relevan...",
    "topik": "Topik pembelajaran..."
  },
  "desain": {
    "kemitraan": "Rekomendasi kemitraan...",
    "lingkungan": "Deskripsi lingkungan...",
    "digital": "Tools: Canva, Kahoot, Quizizz, dll..."
  },
  "pengalaman": {
    "memahami": "Kegiatan awal...",
    "mengaplikasi": "Kegiatan inti...",
    "refleksi": "Kegiatan penutup..."
  },
  "asesmen": {
    "awal": "Asesmen diagnostik...",
    "proses": "Observasi...",
    "akhir": "Produk/tugas..."
  },
  "lampiran": {
    "materi": "<h3>A. Pengertian [Topik]</h3><p>Penjelasan paragraf pertama...</p><p>Penjelasan paragraf kedua...</p><h3>B. Prinsip Dasar</h3><p>Penjelasan...</p><ul><li>Poin 1</li><li>Poin 2</li></ul><h3>C. Langkah Implementasi</h3><p>Penjelasan...</p>",
    "kisi_kisi": [{"no":1,"tp":"TP 1","indikator":"Indikator...","level":"L1","nomor":"1-3"}],
    "kunci": "1. Jawaban A\\n2. Jawaban B",
    "rubrik": "Aspek Pemahaman:\\n- Skor 4: Sangat baik\\n- Skor 3: Baik"
  }
}

ATURAN PENTING:
1. Untuk field "materi" di lampiran, WAJIB gunakan HTML tags: <h3> untuk judul sub-bab, <p> untuk paragraf, <ul><li> untuk list
2. JANGAN gunakan markdown (** atau ##)
3. Materi harus terstruktur minimal 3 sub-bab (A, B, C)
4. Output HANYA JSON tanpa \`\`\` wrapper`;

// Fallback untuk ATP
function fallbackTP(elemenNama, fase) {
    const verbs = ['memahami','menjelaskan','menganalisis','menerapkan','mengevaluasi'];
    return Array.from({length:5}, (_,i)=>({no:i+1,text:`Peserta didik mampu ${verbs[i]} konsep dasar ${elemenNama} sesuai level ${fase}.`}));
}

// Status endpoint
app.get('/api/status', (req,res)=>res.json({status:'ok',model: MODEL_NAME}));

// ========================================
// 🔹 START SERVER
// ========================================
const PORT = process.env.PORT || 3001;

app.get('/atp', (req, res) => res.sendFile(path.join(__dirname, 'public', 'atp', 'index.html')));
app.get('/rpm', (req, res) => res.sendFile(path.join(__dirname, 'public', 'rpm', 'index.html')));

module.exports = app;