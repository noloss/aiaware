# PromptSentinel

Chrome-laajennus, joka opettaa käyttäjiä tunnistamaan AI-vastauksiin liittyviä tietoturvariskejä.

## Kehitysympäristö

**Aktivoi aina venv ennen Python-komentoja:**
```bash
source venv/bin/activate
```

**gh CLI sijaitsee:** `~/.local/bin/gh` (lisää PATH:iin tarvittaessa: `export PATH="$HOME/.local/bin:$PATH"`)

## Hakemistorakenne

```
extension/          # Chrome-laajennus (koodariagentti kirjoittaa tänne)
framework/          # Agenttikehikko
  planner.py        # PRD → GitHub Issues
  coder.py          # Issue → branch + koodi + PR
  reviewer.py       # PR → review + approve/request changes
  github.py         # gh CLI -wrapper
  config.py         # Ympäristömuuttujat
  prompts/          # Agent-promptit
prd.md              # Tuotevaatimukset (plannerin lähde)
tasks.json          # Plannerin generoima tehtävälista (gitignoressa)
```

## Agenttipipeline

```
python framework/planner.py              # Luo GitHub Issues PRD:stä
python framework/coder.py --issue <N>    # Koodaa issue branchille + avaa PR
python framework/reviewer.py --pr <N>   # Reviewaa PR, hyväksyy tai palauttaa
```

## Kieli

Kaikki agent-promptit ja issuet englanninkielisiä. Kommentit koodissa englanniksi.

## Tärkeää

- Extension-kansion koodi on JavaScript (ES6+), ei TypeScript
- Manifest V3
- Ei backendia – kaikki data paikallisesti LocalStoragessa
- Älä riko Clauden tai Geminin normaalia käyttöliittymää
