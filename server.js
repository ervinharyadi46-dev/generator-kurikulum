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
    console.error('❌ GEMINI_API_KEY tidak ditemukan! Cek Environment Variables.');
    process.exit(1);
}
console.log('🔑 API Key terdeteksi');

const MODEL_NAME = 'gemini-1.5-flash';
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: MODEL_NAME });
console.log(`📚 Model: ${MODEL_NAME}`);

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
        identifikasi: {
            murid: "Karakteristik murid akan ditampilkan di sini",
            lintas_disiplin: "Mapel lintas disiplin akan ditampilkan di sini",
            topik: "Topik pembelajaran akan ditampilkan di sini"
        },
        desain: {
            kemitraan: "Rekomendasi kemitraan akan ditampilkan di sini",
            lingkungan: "Deskripsi lingkungan akan ditampilkan di sini",
            digital: "Tools digital akan ditampilkan di sini"
        },
        pengalaman: {
            memahami: "Kegiatan awal akan ditampilkan di sini",
            mengaplikasi: "Kegiatan inti akan ditampilkan di sini",
            refleksi: "Kegiatan penutup akan ditampilkan di sini"
        },
        asesmen: {
            awal: "Asesmen diagnostik akan ditampilkan di sini",
            proses: "Observasi proses akan ditampilkan di sini",
            akhir: "Asesmen akhir akan ditampilkan di sini"
        },
        lampiran: {
            materi: "<h3>A. Pendahuluan</h3><p>Materi bahan ajar akan ditampilkan di sini setelah AI berhasil generate.</p><h3>B. Isi Materi</h3><p>Penjelasan detail materi akan muncul di sini.</p><h3>C. Kesimpulan</h3><p>Rangkuman materi akan ditampilkan di sini.</p>",
            kisi_kisi: [
                {no: 1, tp: "TP 1", indikator: "Indikator soal 1", level: "L1", nomor: "1"},
                {no: 2, tp: "TP 2", indikator: "Indikator soal 2", level: "L2", nomor: "2"}
            ],
            kunci: "1. Jawaban A\n2. Jawaban B",
            rubrik: "Aspek Pemahaman:\n- Skor 4: Sangat baik\n- Skor 3: Baik\n- Skor 2: Cukup\n- Skor 1: Kurang"
        }
    };
}

// ========================================
// 🔹 ENDPOINT ATP (OPTIMIZED BATCH CALL)
// ========================================
app.post('/api/atp', async (req, res) => {
    try {
        const { identitas, elemenList } = req.body;
        if (!identitas || !elemenList?.length) {
            return res.status(400).json({ success: false, message: 'Data tidak lengkap' });
        }

        // Susun daftar elemen menjadi teks terstruktur untuk AI
        const daftarElemenTeks = elemenList.map((elem, idx) => 
            `${idx + 1}. Elemen: ${elem.nama}\n   CP: ${elem.cp}`
        ).join('\n\n');

        // Mengubah prompt agar memproses sekaligus semua elemen dalam 1 kali panggil
        const prompt = `Ahli kurikulum Kurikulum Merdeka Indonesia. Buatkan Tujuan Pembelajaran (TP) dari data berikut:
Mapel: ${identitas.mapel} | Fase: ${identitas.fase}

Daftar Elemen dan CP:
${daftarElemenTeks}

TUGAS:
Buat MINIMAL 5 TP untuk masing-masing elemen di atas. 
Output WAJIB berupa JSON Array of Objects dengan struktur persis seperti ini:
[
  {
    "elemenNama": "Tulis nama elemen di sini sesuai input",
    "tujuanPembelajaran": [
      {"no": 1, "text": "Peserta didik mampu..."},
      {"no": 2, "text": "..."}
    ]
  }
]`;

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
            } catch (err) { 
                lastError = err;
                attempts++; 
                console.error(`[ATP] Percobaan ${attempts} gagal:`, err.message);
                if (attempts < 3) await new Promise(r => setTimeout(r, 1500 * attempts)); 
            }
        }
        
        if (!result) throw new Error(`AI error: ${lastError?.message || 'Gagal merespons'}`);

        const raw = result.response.text();
        let aiJson;
        try {
            aiJson = JSON.parse(raw);
        } catch (parseError) {
            console.error('[ATP] Gagal baca JSON dari AI, beralih ke total fallback.');
            aiJson = [];
        }

        // Mapping kembali hasil dari AI dicocokkan dengan data asli dari client
        const hasil = elemenList.map(elem => {
            // Cari data yang namanya mirip/sama di response AI
            const match = Array.isArray(aiJson) && aiJson.find(item => 
                item.elemenNama?.toLowerCase().trim() === elem.nama?.toLowerCase().trim()
            );

            let tp = match ? match.tujuanPembelajaran : null;

            // Validasi kelayakan hasil TP
            if (!Array.isArray(tp) || tp.length < 5) {
                console.warn(`[ATP] Menggunakan fallback untuk elemen: ${elem.nama}`);
                tp = fallbackTP(elem.nama, identitas.fase);
            }

            return { 
                elemen: elem.nama, 
                cp: elem.cp, 
                pertemuan: elem.pertemuan, 
                jp: elem.jp, 
                tujuanPembelajaran: tp 
            };
        });

        res.json({ success: true, data: hasil });
    } catch (e) {
        console.error('❌ ATP Error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ========================================
// 🔹 ENDPOINT RPM
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
            } catch (err) {
                lastError = err;
                attempts++;
                console.error(`[RPM] Percobaan ${attempts} gagal:`, err.message);
                if (attempts < 3) await new Promise(r => setTimeout(r, 1500 * attempts));
            }
        }

        if (!result) {
            throw new Error(`AI error setelah 3 percobaan: ${lastError?.message || 'Gagal merespons'}`);
        }

        const raw = result.response.text();
        let data;
        try {
            data = JSON.parse(raw);
            if (!data.identifikasi || !data.desain || !data.pengalaman || !data.asesmen || !data.lampiran) {
                console.warn('[RPM] Struktur JSON tidak lengkap, menggunakan fallback');
                data = fallbackRPM();
            }
        } catch (parseError) {
            console.error('[RPM] Gagal parse JSON dari AI:', parseError.message);
            data = fallbackRPM();
        }

        res.json({ success: true, data: data });

    } catch (e) {
        console.error('❌ RPM Error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ========================================
// 🔹 STATUS ENDPOINT
// ========================================
app.get('/api/status', (req, res) => {
    res.json({ status: 'ok', model: MODEL_NAME });
});

// ========================================
// 🔹 ROUTES UNTUK STATIC FILES
// ========================================
app.get('/atp', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'atp', 'index.html'));
});

app.get('/rpm', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'rpm', 'index.html'));
});

// ========================================
// 🔹 LOCAL SERVER RUNNER & EXPORT VERCEL
// ========================================
// Blok ini membuat aplikasi bisa dijalankan di lokal dengan command `node <nama_file>.js`
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`🚀 Server berjalan lokal di http://localhost:${PORT}`);
    });
}

module.exports = app;