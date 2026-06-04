require('dotenv').config();

async function cekModel() {
    const apiKey = process.env.GEMINI_API_KEY;
    console.log("⏳ Sedang mengambil daftar model dari Google...");
    
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await response.json();
        
        if (data.error) {
            console.error("❌ Error API:", data.error.message);
            return;
        }
        
        console.log("✅ Model yang bisa kamu gunakan (cari yang berakhiran 'flash' atau 'pro' dan dukung generateContent):");
        data.models.forEach(m => {
            if (m.supportedGenerationMethods.includes("generateContent")) {
                console.log(`- ${m.name.replace('models/', '')}`);
            }
        });
    } catch (e) {
        console.error("❌ Gagal menghubungi server Google:", e.message);
    }
}

cekModel();