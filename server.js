require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================================
// 1. INISIALISASI GEMINI AI
// ============================================================================
const apiKey = process.env.GEMINI_API_KEY;
let model;

// 🔥 MODEL YANG TERSEDIA DI SERVER ANDA (Sesuai hasil terminal pengecekan)
const MODEL_NAME = 'gemini-3.5-flash'; 

if (!apiKey) {
    console.error('❌ GEMINI_API_KEY tidak ditemukan di environment variables!');
} else {
    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        model = genAI.getGenerativeModel({ 
            model: MODEL_NAME,
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 8192,
                // Memaksa AI HANYA mengeluarkan output dalam bentuk JSON murni
                responseMimeType: "application/json", 
            }
        });
        console.log(`✅ Model AI [${MODEL_NAME}] berhasil diinisialisasi`);
    } catch (error) {
        console.error('❌ Gagal inisialisasi model:', error.message);
    }
}

// ============================================================================
// 2. FUNGSI BANTUAN: AUTO-RETRY & GENERATE
// ============================================================================
async function generateAIResponse(prompt, maxRetries = 3) {
    if (!model) throw new Error("Server belum siap: API Key Gemini tidak valid.");

    let attempts = 0;
    let lastError;

    while (attempts < maxRetries) {
        try {
            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text()?.trim();
            
            if (!text) throw new Error('AI merespons dengan teks kosong');
            
            // Parse JSON langsung karena kita menggunakan responseMimeType
            return JSON.parse(text); 
        } catch (error) {
            attempts++;
            lastError = error;
            console.log(`⚠️ [Attempt ${attempts}/${maxRetries}] AI Error: ${error.message}`);
            
            // Jika error 404, tidak perlu retry
            if (error.message.includes('404')) {
                throw new Error(`Model '${MODEL_NAME}' tidak ditemukan. Pastikan library @google/generative-ai sudah versi terbaru (npm install @google/generative-ai@latest).`);
            }

            if (attempts === maxRetries) break;
            
            // Jeda waktu sebelum mencoba lagi
            await new Promise(resolve => setTimeout(resolve, 2000 * attempts));
        }
    }
    
    throw new Error(`AI gagal setelah ${maxRetries} percobaan. Error terakhir: ${lastError.message}`);
}

// ============================================================================
// 3. ENDPOINT: GENERATE ATP (/api/atp)
// ============================================================================
app.post('/api/atp', async (req, res) => {
    try {
        const { identitas, elemenList } = req.body;
        
        if (!identitas || !elemenList || elemenList.length === 0) {
            return res.status(400).json({ success: false, message: 'Data tidak lengkap' });
        }

        console.log(`\n📥 [START] Request ATP - Mapel: ${identitas.mapel} | Fase: ${identitas.fase}`);
        const hasilATP = [];

        for (let i = 0; i < elemenList.length; i++) {
            const elem = elemenList[i];
            console.log(`🔄 Memproses Elemen [${i + 1}/${elemenList.length}]: ${elem.nama}`);

            const prompt = `Anda ahli kurikulum Kurikulum Merdeka Indonesia. Buatkan Tujuan Pembelajaran (TP).
Mata Pelajaran: ${identitas.mapel}
Fase: ${identitas.fase}
Elemen: ${elem.nama}
Capaian Pembelajaran: ${elem.cp}

INSTRUKSI:
1. Buat MINIMAL 5 Tujuan Pembelajaran.
2. Setiap TP mengandung KOMPETENSI (kata kerja operasional) dan KONTEN (materi).
3. Gunakan Bahasa Indonesia baku.
4. KELUARKAN HANYA JSON ARRAY dengan struktur persis seperti ini:
[{"no":1,"text":"Peserta didik mampu..."},{"no":2,"text":"..."}]`;

            try {
                const tpArray = await generateAIResponse(prompt);
                
                hasilATP.push({
                    elemen: elem.nama,
                    cp: elem.cp,
                    jumlahPertemuan: parseInt(elem.pertemuan) || 1,
                    jp: elem.jp,
                    tujuanPembelajaran: Array.isArray(tpArray) ? tpArray : []
                });
                console.log(`✅ Berhasil: ${tpArray.length} TP dibuat untuk ${elem.nama}`);
            } catch (elemError) {
                console.error(`❌ Gagal pada elemen ${elem.nama}:`, elemError.message);
                throw elemError; 
            }

            // Jeda 1.5 detik antar elemen untuk menghindari batas Rate Limit API
            if (i < elemenList.length - 1) await new Promise(resolve => setTimeout(resolve, 1500));
        }

        console.log('✅ [DONE] ATP berhasil dibuat seluruhnya!');
        res.json({ success: true, data: hasilATP });

    } catch (error) {
        console.error('❌ [ERROR ATP]:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// 4. ENDPOINT: GENERATE RPM (/api/rpm)
// ============================================================================
app.post('/api/rpm', async (req, res) => {
    try {
        console.log(`\n📥 [START] Request RPM masuk`);
        const dataRpm = req.body;
        
        const prompt = `Anda adalah ahli penyusunan Rencana Pelaksanaan Pembelajaran (RPM) Kurikulum Merdeka.
Berdasarkan data berikut, buatkan detail kegiatan pembelajaran.
Data: ${JSON.stringify(dataRpm)}

INSTRUKSI:
1. Buat langkah-langkah kegiatan dengan jelas.
2. KELUARKAN HANYA JSON OBJECT dengan struktur yang sesuai standar Anda.
Contoh format output JSON yang diharapkan (bisa disesuaikan dengan struktur RPM Anda):
{
  "kegiatanPendahuluan": ["Berdoa", "Apersepsi"],
  "kegiatanInti": ["Langkah 1...", "Langkah 2..."],
  "kegiatanPenutup": ["Refleksi", "Salam"]
}`;

        const hasilRpm = await generateAIResponse(prompt);
        
        console.log('✅ [DONE] RPM berhasil dibuat!');
        res.json({ success: true, data: hasilRpm });

    } catch (error) {
        console.error('❌ [ERROR RPM]:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// 5. START SERVER
// ============================================================================
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`================================================`);
    console.log(`🚀 Server berjalan di: http://localhost:${PORT}`);
    console.log(`📚 Model Aktif: ${MODEL_NAME}`);
    console.log(`🛡️  Status: Siap Menerima Request`);
    console.log(`================================================\n`);
});