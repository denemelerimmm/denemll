# Kumar Bırak (PWA)

Basit, çevrimdışı çalışabilen bir kumar bırakma uygulaması. Veriler cihazda (localStorage) saklanır. Next.js kurulumu beklenmeden çalışır.

## Çalıştırma

```bash
cd /workspace/quit-gambling
python3 -m http.server 8000
```

Ardından `http://localhost:8000` adresine gidin. Telefonunuzda ana ekrana ekleyip PWA olarak kullanabilirsiniz.

## Özellikler

- Günlük yoklama ve seri takibi
- Tetikleyici günlüğü (tür, şiddet, not)
- 5 dakikalık dürtü sayacı + nefes animasyonu
- Ayarlar: bırakış tarihi, günlük hedef, motivasyon notları
- Hızlı not ve acil durum mesajı
- Veri dışa/içe aktarma (JSON)
- PWA: manifest + service worker ile çevrimdışı
- Giriş/Kayıt (yerel, SHA-256 hash), kullanıcıya özgü veri
- Admin Paneli: toplam kullanıcı, bugün kayıt, online kullanıcı, toplam ciro; test ödemesi ekleme

## Not

Daha sonra Next.js/TS sürümüne taşınabilir. Şu an frameworksüz minimal sürüm, hızlı kullanım içindir.