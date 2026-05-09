# PRD: PromptSentinel – AI Safety & Literacy Extension
Versio: 1.0

## Tavoite
Opastaa käyttäjiä tunnistamaan AI-vastauksiin liittyviä riskejä (kuten haitallisia linkkejä ja prompt injectionia) simuloitujen "hyökkäysten" ja reaaliaikaisen valvonnan avulla.

---

## 1. Ongelman kuvaus ja ratkaisu
**Ongelma:** Käyttäjät luottavat sokeasti LLM-malleihin (Claude, Gemini, ChatGPT). Tämä altistaa heidät phishing-linkeille, tietovuodoille ja epäsuoralle prompt injectionille.

**Ratkaisu:** Chrome-laajennus, joka toimii "opettavana kerroksena" keskustelun päällä. Se simuloi riskejä turvallisesti ja antaa välitöntä palautetta vaarallisesta toiminnasta.

---

## 2. Kohderyhmä
- Yrityskäyttäjät, jotka käsittelevät herkkää tietoa
- Tietoturvasta kiinnostuneet kuluttajat
- Oppilaitokset, jotka haluavat opettaa tekoälyn lukutaitoa

---

## 3. Julkaisusuunnitelma (Release Roadmap)

### Release 1: "The Core Hook" (MVP)
**Tavoite:** Perusinfra ja linkkien kaappaus.

**Toiminnallisuus:**
- Manifest V3 -pohja
- Content script, joka tunnistaa Claude.ai ja Gemini.google.com chat-ikkunat
- Linkkien klikkausten seuranta chatin sisällä
- Yksinkertainen modal-ikkuna (HTML/CSS), joka estää linkin avautumisen ja näyttää varoituksen: "Tämä on opetushetki!"
- Mahdollisuus jatkaa alkuperäiseen linkkiin

### Release 2: "Simulation Engine"
**Tavoite:** Luoda "Hoxhunt-kokemus".

**Toiminnallisuus:**
- Arvontamoduuli: Vain tietty % linkeistä (esim. 5 %) laukaisee opetustilan
- Dashboard-pohja: Laajennuksen ikoni (popup.html) näyttää, kuinka monta "ansaa" käyttäjä on välttänyt
- Local Storage: Tallennetaan statistiikka (klikkaukset, estetyt) paikallisesti selaimeen

### Release 3: "DLP Lite" (Data Loss Prevention)
**Tavoite:** Estää käyttäjää vuotamasta tietoa.

**Toiminnallisuus:**
- Input-kentän monitorointi reaaliajassa
- Regex-tunnistus: Sähköpostiosoitteet, IBAN-tilinumerot, API-avaimet (esim. sk-...)
- Soft Warning: Jos teksti sisältää herkkää tietoa, syöttökentän reuna muuttuu keltaiseksi ja pieni tooltip varoittaa tietoturvasta

### Release 4: "Prompt Injection Awareness"
**Tavoite:** Opastaa monimutkaisemmissa hyökkäyksissä.

**Toiminnallisuus:**
- Tunnistaa, kun käyttäjä antaa "Summarize this URL" -tyyppisen komennon
- Näyttää infoviestin: "Varoitus: Ulkopuolinen sisältö voi sisältää piilotettuja ohjeita, jotka kaappaavat tekoälyn."
- Lisätään lyhyet (30 sekunnin luettavat) "mikro-oppitunnit" injection-tyypeistä

### Release 5: "Gamification & UI Polish"
**Tavoite:** Sitouttaminen ja ammattimainen ulkoasu.

**Toiminnallisuus:**
- Safety Score: Algoritmi, joka laskee arvosanan käyttäjän toiminnalle
- Badges: "Prompt Master", "Security Aware", jne.
- Dark Mode -tuki ja animaatiot modaleihin
- Asetussivu, jossa voi säätää simulaatioiden tiheyttä

### Release 6: "Enterprise & Store Ready"
**Tavoite:** Julkaisu Chrome Web Storeen.

**Toiminnallisuus:**
- Tietosuojaseloste ja Store-materiaalien valmistelu
- Koodin optimointi ja bugien korjaus (Claude/Gemini UI-muutosten kestävyys)
- Valinnainen: Mahdollisuus exportata raportti (esim. IT-osastolle todisteeksi suoritetusta koulutuksesta)

---

## 4. Tekninen määrittely
- **Kieli:** JavaScript (ES6+), HTML5, CSS3
- **Arkkitehtuuri:**
  - `background.js`: Hoitaa globaalit tapahtumat (ei pakollinen MVP:ssä)
  - `content.js`: Lukee DOM-puuta ja injektoi UI-elementit
  - `popup.html`: Käyttäjän statustiedot
  - `options.html`: Asetukset
- **Tietoturva:** Kaikki datan käsittely tapahtuu paikallisesti (ei backendia tässä vaiheessa)

---

## 5. Hyväksymiskriteerit (Acceptance Criteria)
- Laajennus ei riko Clauden tai Geminin normaalia käyttöliittymää
- Linkin klikkaaminen chatin sisällä pysähtyy, jos arpa osuu kohdalle
- Käyttäjä pääsee aina alkuperäiseen kohteeseen "Ymmärrän" -klikkauksen jälkeen
- Laajennus ei kerää tai lähetä käyttäjän keskusteluja ulkopuolisille palvelimille
