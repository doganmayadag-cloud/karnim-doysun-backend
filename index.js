require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 5000;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(cors());
app.use(express.json());

app.get('/', async (req, res) => {
  // Supabase'i de aktif tutmak için küçük bir sorgu
  await supabase.from('lokantalar').select('id').limit(1);
  res.json({ mesaj: 'Karnım Doysun Backend çalışıyor! 🚀' });
});

// KAYIT OL
app.post('/api/kayit', async (req, res) => {
  try {
    const { adSoyad, email, telefon, sifre, kullaniciTipi } = req.body;

    if (!adSoyad || !email || !sifre) {
      return res.status(400).json({ hata: 'Lütfen tüm alanları doldur.' });
    }

    const { data: mevcut } = await supabase
      .from('kullanicilar')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (mevcut) {
      return res.status(409).json({ hata: 'Bu e-posta zaten kayıtlı.' });
    }

    const sifreHash = await bcrypt.hash(sifre, 10);

    const { data, error } = await supabase
      .from('kullanicilar')
      .insert([{
        ad_soyad: adSoyad,
        email: email,
        telefon: telefon,
        sifre: sifreHash,
        kullanici_tipi: kullaniciTipi
      }])
      .select();

    if (error) {
      return res.status(500).json({ hata: error.message });
    }

    const yeniKullanici = data[0];

    if (kullaniciTipi === 'isletme') {
      const { data: lokantaData, error: lokantaError } = await supabase
        .from('lokantalar')
        .insert([{
          ad: adSoyad,
          telefon: telefon,
          ilce: 'Kadıköy',
          puan: 0,
          aktif: false,
          onaylandi: false,
          sahip_id: yeniKullanici.id
        }])
        .select();

      if (lokantaError) {
        return res.status(500).json({ hata: 'Lokanta oluşturulamadı: ' + lokantaError.message });
      }
      yeniKullanici.lokanta_id = lokantaData[0].id;
      yeniKullanici.lokanta_onaylandi = false;
    }

    delete yeniKullanici.sifre;
    res.json(yeniKullanici);

  } catch (err) {
    res.status(500).json({ hata: err.message });
  }
});

// GİRİŞ YAP
app.post('/api/giris', async (req, res) => {
  try {
    const { email, sifre } = req.body;

    if (!email || !sifre) {
      return res.status(400).json({ hata: 'E-posta ve şifre gerekli.' });
    }

    const { data: kullanici, error } = await supabase
      .from('kullanicilar')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (error || !kullanici) {
      return res.status(401).json({ hata: 'E-posta veya şifre hatalı.' });
    }

    const dogruMu = await bcrypt.compare(sifre, kullanici.sifre);

    if (!dogruMu) {
      return res.status(401).json({ hata: 'E-posta veya şifre hatalı.' });
    }

    if (kullanici.kullanici_tipi === 'isletme') {
      const { data: lokantaData } = await supabase
        .from('lokantalar')
        .select('id, onaylandi')
        .eq('sahip_id', kullanici.id)
        .maybeSingle();
      if (lokantaData) {
        kullanici.lokanta_id = lokantaData.id;
        kullanici.lokanta_onaylandi = lokantaData.onaylandi;
      }
    }

    delete kullanici.sifre;
    res.json(kullanici);

  } catch (err) {
    res.status(500).json({ hata: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Backend ${PORT} portunda çalışıyor!`);
});