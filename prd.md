# PRD: PromptSentinel – DLP Engine
Versio: 2.0

## Tavoite
Estää käyttäjiä vahingossa jakamasta arkaluonteista tietoa (API-avaimet, luottokortit, henkilötiedot) AI-chattipalveluihin. Laajennus valvoo syöttökenttää reaaliajassa ja varoittaa ennen kuin tieto lähtee.

Zero-Network-periaate: "PromptSentinel ei koskaan lähetä tietoa verkkoon. Kirjoittamasi teksti ei koskaan poistu koneeltasi."

## Kohderyhmä
- Kehittäjät jotka copypasteavat koodia ja avaimia chattiin
- Yrityskäyttäjät jotka käsittelevät henkilötietoja
- Kaikki jotka käyttävät Claude.ai tai Geminiä päivittäin

---

## Release 1: "Smart Detection Engine"
**Tavoite:** Luotettava arkaluonteisen datan tunnistus ilman false positiveja.

### 1.1 Luottokorttien tunnistus (Luhn-algoritmi)
Kaksi vaihetta:
- Vaihe A: Regex tunnistaa 13–19 numeron jonon (välilyönnit ja viivat sallittu)
- Vaihe B: Luhn-algoritmi tarkistaa onko kyseessä oikea korttinumero – jos epäonnistuu, laajennus pysyy hiljaa

Hälytystaso: 🔴 High

### 1.2 API-avainten tunnistus
Kaksi menetelmää:
- Tunnetut prefiksit: `sk-`, `sk-ant-`, `ghp_`, `AKIA`, `AIza`, `Bearer `
- Shannon-entropian tarkistus: 32–64 merkin satunnainen aakkosnumeerinen jono, jonka entropia > 4.5 bits/char – todennäköisesti API-avain tai token

Hälytystaso: 🔴 High

### 1.3 SSN-tunnistus (Social Security Number)
- Pattern: `\b\d{3}-\d{2}-\d{4}\b`
- Validointi: Hylätään SSA:n "invalid" alueet (alkaa 000, 666, tai 900–999) – ei false positiveja tavallisille viivatuille numeroille

Hälytystaso: 🔴 High

### 1.4 Kolmiportainen hälytystaso
- 🟡 Low: Sähköpostiosoite, IBAN
- 🟠 Medium: Salasanapattern (`password: xxx`), suomalainen henkilötunnus
- 🔴 High: API-avain, luottokortti, SSN

Varoitusbannerin väri ja teksti muuttuvat tason mukaan.

### Hyväksymiskriteerit
- `4532015112830366` → Luhn pass → 🔴 banneri
- `1234567890123456` → Luhn fail → ei banneria
- `sk-1234567890abcdefghij` → 🔴 banneri
- `user@example.com` → 🟡 banneri
- `123-45-6789` → SSN valid → 🔴 banneri
- `000-12-3456` → SSN invalid range → ei banneria
- Normaali kirjoittaminen ei hidastu (debounce 300ms)

---

## Release 2: "Shadow Block"
**Tavoite:** Estää vahingollinen lähetys 🔴 High-alertin ollessa aktiivinen.

### 2.1 Enter-näppäimen kaappaus
- Kun 🔴 High-alert on näkyvissä ja käyttäjä painaa Enter (tai klikkaa Send-nappia)
- Näytetään "Security Intercept" -popup: "Syötteessäsi on arkaluonteista tietoa. Haluatko varmasti lähettää?"
- Kaksi nappia: "Peruuta" (suositeltava) ja "Lähetä silti"
- 🟡 ja 🟠 alertit eivät kaappaa Enter-näppäintä – vain soft warning

### Hyväksymiskriteerit
- Given 🔴 alert aktiivinen, When käyttäjä painaa Enter, Then popup ilmestyy eikä viesti lähde
- Given popup näkyvissä, When käyttäjä klikkaa "Lähetä silti", Then viesti lähtee normaalisti
- Given popup näkyvissä, When käyttäjä klikkaa "Peruuta", Then popup sulkeutuu ja teksti jää kenttään
- Given 🟡 tai 🟠 alert, When käyttäjä painaa Enter, Then viesti lähtee normaalisti (ei kaappausta)

---

## Release 3: "Zero-Network & Store Ready"
**Tavoite:** Selkeä tietosuovaviestintä ja Chrome Web Store -julkaisu.

### 3.1 Zero-Network-brändäys
- Popup-sivu näyttää: "PromptSentinel on Zero-Network-laajennus. Meillä ei ole palvelinta; kirjoittamasi teksti ei koskaan poistu koneeltasi."
- manifest.json description: "AI chat DLP guard – Zero-Network, your data never leaves your device."
- Tietosuojakäytäntö (privacy policy) -teksti Store-listingille

### 3.2 Chrome Web Store -valmistelu
- Store-kuvaus, kuvakaappaukset, promotional tile
- Koodin optimointi ja testaus molemmilla alustoilla (Claude.ai, Gemini)

### Hyväksymiskriteerit
- Popup näyttää Zero-Network-viestin selkokielellä
- manifest.json description vastaa Store-vaatimuksia (max 132 merkkiä)
- Laajennus läpäisee Chrome Web Store policy review -tarkistuslistan

---

## Tekninen määrittely
- Kieli: JavaScript (ES6+), HTML5, CSS3
- Manifest V3
- Ei backendia – kaikki logiikka selaimessa
- Olemassa oleva pohja: `extension/dlp.js` (perustunnistus), `extension/manifest.json`
