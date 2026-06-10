require('dotenv').config();

async function cekModelTersedia() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error("❌ GEMINI_API_KEY tidak ditemukan di .env");
        return;
    }

    console.log("🔍 Mengecek model yang tersedia untuk API Key Anda...");
    
    try {
        // Kita bypass library SDK dan nembak langsung ke API REST Google
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await response.json();

        if (data.models) {
            console.log("\n✅ MODEL YANG TERSEDIA DAN BISA ANDA GUNAKAN:");
            console.log("-------------------------------------------------");
            data.models
                // Filter hanya model yang mendukung fitur generateContent (teks)
                .filter(m => m.supportedGenerationMethods.includes("generateContent"))
                .forEach(m => {
                    console.log(`- Nama: ${m.name.replace('models/', '')}`);
                });
            console.log("-------------------------------------------------\n");
            console.log("💡 TIPS: Copy salah satu nama di atas (misal: gemini-2.0-flash atau gemini-2.5-flash) lalu masukkan ke server.js Anda.");
        } else {
            console.error("❌ Gagal mendapatkan daftar model:", data);
        }
    } catch (error) {
        console.error("❌ Terjadi kesalahan jaringan:", error.message);
    }
}

cekModelTersedia();