require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const app = express();
const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
if (!supabaseUrl || !supabaseKey) {
  throw new Error('Supabase URL ve anahtarı ayarlanmamış.');
}

const supabase = createClient(supabaseUrl, supabaseKey);
const resend = new Resend(process.env.RESEND_API_KEY);

// Geçici doğrulama kodları
const dogrulamaKodlari = {};

app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json());

// ── CANLI TUT ──
app.get('/', async (req, res) => {
  await supabase.from('lokantalar').select('id').limit(1);
  res.json({ mesaj: 'Karnım Doysun Backend çalışıyor! 🚀' });
});

// ── KAYIT OL ──
app.post('/api/kayit', async (req, res) => {
  try {
    const { adSoyad, email, telefon, sifre, kullaniciTipi } = req.body;

    if (!adSoyad || !email || !sifre) {
      return res.status(400).json({ hata: 'Lütfen tüm alanları doldur.' });
    }
    if (sifre.length < 6) {
      return res.status(400).json({ hata: 'Şifre en az 6 karakter olmalı.' });
    }

    // E-posta zaten kayıtlı mı?
    const { data: mevcut } = await supabase
      .from('kullanicilar')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (mevcut) {
      return res.status(409).json({ hata: 'Bu e-posta zaten kayıtlı.' });
    }

    const sifreHash = await bcrypt.hash(sifre, 12);

    // 6 haneli doğrulama kodu üret
    const kod = crypto.randomInt(100000, 999999).toString();
    const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 dakika

    dogrulamaKodlari[email] = {
      kod, expires, adSoyad, telefon,
      sifreHash, kullaniciTipi: kullaniciTipi || 'musteri'
    };

    // Resend ile mail gönder
    const { error: mailError } = await resend.emails.send({
      from: 'Karnım Doysun <onboarding@resend.dev>',
      to: email,
      subject: 'Karnım Doysun — E-posta Doğrulama Kodun',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f9f9f9;border-radius:12px;">
          <div style="text-align:center;margin-bottom:24px;">
            <h2 style="color:#173A2E;margin:0;font-size:22px;">🍽 Karnım Doysun</h2>
            <p style="color:#666;font-size:13px;margin-top:6px;">Hesabını doğrula</p>
          </div>
          <div style="background:#fff;border-radius:10px;padding:28px;text-align:center;border:1px solid #e8e8e8;">
            <p style="color:#333;font-size:15px;margin-bottom:20px;">Merhaba <strong>${adSoyad}</strong>,</p>
            <p style="color:#555;font-size:13px;margin-bottom:20px;">Karnım Doysun hesabını oluşturmak için doğrulama kodunu gir:</p>
            <div style="font-size:38px;font-weight:700;letter-spacing:10px;color:#173A2E;padding:20px;background:#FAF6EC;border-radius:8px;border:2px dashed #E8B341;">
              ${kod}
            </div>
            <p style="color:#999;font-size:12px;margin-top:16px;">⏱ Bu kod <strong>10 dakika</strong> geçerlidir.</p>
          </div>
          <p style="color:#bbb;font-size:11px;text-align:center;margin-top:20px;">
            Bu e-postayı siz talep etmediyseniz güvenle görmezden gelebilirsiniz.
          </p>
        </div>
      `
    });

    if (mailError) {
      console.error('Mail hatası:', mailError);
      return res.status(500).json({ hata: 'Doğrulama kodu gönderilemedi.' });
    }

    res.json({ mesaj: 'Doğrulama kodu gönderildi.', email });

  } catch (err) {
    console.error('Kayıt hatası:', err);
    res.status(500).json({ hata: err.message });
  }
});

// ── KODU YENİDEN GÖNDER ──
app.post('/api/dogrulama-gonder', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ hata: 'E-posta gerekli.' });

  const mevcut = dogrulamaKodlari[email];
  if (!mevcut) return res.status(400).json({ hata: 'Önce kayıt ol.' });

  const kod = crypto.randomInt(100000, 999999).toString();
  dogrulamaKodlari[email] = { ...mevcut, kod, expires: new Date(Date.now() + 10 * 60 * 1000) };

  try {
    await resend.emails.send({
      from: 'Karnım Doysun <onboarding@resend.dev>',
      to: email,
      subject: 'Karnım Doysun — Yeni Doğrulama Kodun',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;">
          <h2 style="color:#173A2E;">🍽 Karnım Doysun</h2>
          <p>Yeni doğrulama kodun:</p>
          <div style="font-size:38px;font-weight:700;letter-spacing:10px;color:#173A2E;padding:20px;background:#FAF6EC;border-radius:8px;border:2px dashed #E8B341;text-align:center;">
            ${kod}
          </div>
          <p style="color:#999;font-size:12px;margin-top:16px;">⏱ Bu kod 10 dakika geçerlidir.</p>
        </div>
      `
    });
    res.json({ mesaj: 'Yeni kod gönderildi.' });
  } catch (err) {
    res.status(500).json({ hata: 'Kod gönderilemedi.' });
  }
});

// ── E-POSTA DOĞRULA ve KAYDI TAMAMLA ──
app.post('/api/dogrula', async (req, res) => {
  try {
    const { email, kod } = req.body;
    if (!email || !kod) return res.status(400).json({ hata: 'E-posta ve kod gerekli.' });

    const kayit = dogrulamaKodlari[email];

    if (!kayit) {
      return res.status(400).json({ hata: 'Doğrulama kodu bulunamadı. Tekrar kayıt ol.' });
    }
    if (new Date() > kayit.expires) {
      delete dogrulamaKodlari[email];
      return res.status(400).json({ hata: 'Kodun süresi dolmuş. Yeni kod talep et.' });
    }
    if (kayit.kod !== kod.toString()) {
      return res.status(400).json({ hata: 'Kod geçersiz. Tekrar dene.' });
    }

    // Kod doğru → kullanıcıyı DB'ye kaydet
    const { data, error } = await supabase
      .from('kullanicilar')
      .insert([{
        ad_soyad: kayit.adSoyad,
        email: email,
        telefon: kayit.telefon,
        sifre: kayit.sifreHash,
        kullanici_tipi: kayit.kullaniciTipi,
        email_dogrulandi: true
      }])
      .select();

    if (error) {
      return res.status(500).json({ hata: error.message });
    }

    const yeniKullanici = data[0];

    if (kayit.kullaniciTipi === 'isletme') {
      const { data: lokantaData, error: lokantaError } = await supabase
        .from('lokantalar')
        .insert([{
          ad: kayit.adSoyad,
          telefon: kayit.telefon,
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

    delete dogrulamaKodlari[email];
    delete yeniKullanici.sifre;
    res.json(yeniKullanici);

  } catch (err) {
    console.error('Doğrulama hatası:', err);
    res.status(500).json({ hata: err.message });
  }
});

// ── GİRİŞ YAP ──
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

    if (!kullanici.email_dogrulandi) {
      return res.status(403).json({ hata: 'E-posta adresin henüz doğrulanmamış. Lütfen mailini kontrol et.' });
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
    console.error('Giriş hatası:', err);
    res.status(500).json({ hata: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Backend ${PORT} portunda çalışıyor!`);
});