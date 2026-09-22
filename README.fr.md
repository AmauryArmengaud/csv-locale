# CSV Locale FR

*[English version](README.md)*

Extension Chrome (Manifest V3) qui convertit les CSV téléchargés depuis une liste de sites vers les conventions régionales du poste : séparateur de colonnes, décimale, séparateur de milliers et format de date. L'original est conservé, la copie convertie (`export_fr.csv`) est téléchargée à côté.

Aucune dépendance, aucun appel réseau pour la conversion : tout le traitement est fait localement en JavaScript natif.

## Installation

1. Ouvrir `chrome://extensions`, activer le **mode développeur**.
2. **Charger l'extension non empaquetée** et sélectionner ce dossier.
3. La page de réglages s'ouvre : ajouter le début d'URL des pages qui génèrent les exports (ex. `https://app.exemple.com/rapports`). Chrome demande l'accès au site : l'accepter.
4. Vérifier l'icône de l'extension sur l'onglet du site : le badge **ON** indique que l'extension y est active. Un badge **!** rouge signale un accès manquant.

Fonctionne aussi dans Edge et Brave (Chromium 116+).

## Ce que fait la conversion

| Élément | Source (ex. export US) | Sortie (poste FR) |
|---|---|---|
| Séparateur | `,` | `;` |
| Nombre | `"1,234.50"` | `1234,50` |
| Date | `03/15/2024` | `15/03/2024` |
| Date-heure | `2024-03-15T14:05:09` | `15/03/2024 14:05:09` |
| Date Oracle | `28-FEB-25`, `28-FÉVR.-2025` | `28/02/2025` |
| Timestamp Oracle | `28-FEB-25 02.30.15.000000 PM` | `28/02/2025 14:30:15` |
| Texte avec `;` | `Paris; Lyon` | `"Paris; Lyon"` |
| Encodage | UTF-8 ou Windows-1252 | UTF-8 avec BOM |

Règles de sûreté :

- **Une colonne n'est modifiée que si 100 % de ses valeurs** (hors en-tête et valeurs nulles `N/A`, `null`, `-`…) sont du même type. Une colonne mixte reste intacte.
- **Aucun calcul flottant** : les chiffres sont réécrits comme du texte, zéro perte de précision.
- Les entiers sans séparateur (identifiants, matricules, `00123`) ne changent jamais.
- Les dates sont validées au calendrier (le 31/02 est rejeté). L'ordre jour/mois est déduit des valeurs > 12 ; si toute la colonne est ambiguë, l'indice vient du format de l'export (virgule + point = US) ou du réglage. Un avertissement est alors affiché.
- `1.2.3`, `10-A`, `20240301` ne sont pris ni pour des nombres ni pour des dates.
- La conversion est idempotente : un fichier déjà au format cible n'est pas recopié.
- En cas d'erreur (guillemet non fermé, session expirée…), aucune copie n'est créée et une notification l'explique. L'original n'est jamais touché.

Le séparateur de milliers de sortie est « aucun » par défaut : Excel relit alors toujours la valeur comme un nombre.

## Confidentialité

- **Aucune donnée ne quitte le poste.** La conversion est faite localement, sans serveur, sans télémétrie, sans bibliothèque tierce.
- L'extension ne lit que les téléchargements issus des sites que vous avez ajoutés.
- L'historique (30 dernières conversions) contient des noms de fichiers et des résumés, jamais le contenu des fichiers. Il reste dans le stockage local du navigateur et s'efface depuis les réglages.
- Le diagnostic ne contient que des chemins d'URL, sans paramètres ni jetons de session.

## Permissions demandées

| Permission | Usage |
|---|---|
| `downloads` | Détecter les CSV téléchargés et enregistrer la copie convertie |
| `storage` | Conserver les réglages et l'historique |
| `scripting` | Injecter le script de page sur les sites ajoutés |
| `offscreen` | Créer le fichier converti (impossible depuis un service worker) |
| `notifications` | Afficher le résultat de chaque conversion |
| Accès aux sites (optionnel) | Demandé site par site, uniquement pour ceux que vous ajoutez |

## Architecture

```
manifest.json
src/
  background.js          service worker : écoute chrome.downloads, orchestre
  content/page-hook.js   MAIN world : garde les Blob des exports JS, prend en charge
                         les téléchargements à usage unique (Oracle APEX)
  offscreen/             crée les URL blob des copies (impossible en service worker)
  options/               réglages, test sur fichier, historique
  lib/
    csv.js               décodage, parseur RFC 4180, détection du séparateur
    numbers.js           conventions décimales par votes, parseur strict
    dates.js             formats de date, ordre J/M, fuseaux
    converter.js         typage des colonnes et réécriture (pur, testable)
    capture.js           récupération des octets du téléchargement
    i18n.js              textes de l'interface en français et en anglais
    settings.js, locale.js, urls.js, report.js, output.js
```

Une extension ne peut pas lire un fichier sur le disque. Le contenu est donc récupéré selon la source :

- **Export généré en JavaScript (`blob:`)** : les sites révoquent souvent l'URL juste après le clic. Le script `page-hook.js`, injecté uniquement sur les sites configurés, garde une référence au Blob et diffère sa révocation de 5 minutes. L'extension le lit dès la création du téléchargement.
- **Lien direct (`https:`)** : le fichier est relu par le service worker avec les cookies de session, sinon depuis l'onglet du site.
- **`data:`** : décodé directement.
- **Téléchargement à usage unique (Oracle APEX)** : le serveur prépare le fichier (`POST wwv_flow.ajax`) puis ne le sert qu'une fois (`GET wwv_flow.ajax?...downloadFileId=...`). Une relecture renverrait 404. `page-hook.js` intercepte la demande du fichier, effectue lui-même l'unique requête, puis remet le fichier à l'utilisateur à l'identique (mêmes octets, même nom). Mécanismes couverts : navigation (`location.href`, liens), `apex.navigation.redirect`, `window.open`, iframe cachée (`src`, `setAttribute`, insertion HTML ou jQuery).

### Diagnostic

Le badge de l'icône indique l'état sur l'onglet courant (**ON** actif, **!** inactif). Le script de page est enregistré sur l'origine entière de chaque site, et injecté aussi dans les onglets déjà ouverts. Il écrit dans la console de la page (filtre `CSV Locale FR`) : `hook actif` au chargement, puis `interception` et `fichier remis` à chaque export. Si un téléchargement à usage unique échoue malgré tout, l'historique des réglages affiche un bloc « Diagnostic » (état du hook dans chaque cadre de l'onglet, derniers événements, URL réduites au chemin, sans jeton de session) avec un bouton pour le copier.

## Langue de l'interface

L'interface (réglages, notifications, historique, messages de la console) s'affiche en français si Chrome est en français (`fr`, `fr-FR`, `fr-CA`…), en anglais dans tous les autres cas. Le nom de l'extension suit la même règle (« CSV Locale FR » ou « CSV Locale »), via `_locales/`. Les textes sont centralisés dans `src/lib/i18n.js`, un test vérifie que les deux langues ont exactement les mêmes clés. Le suffixe par défaut du fichier converti est `_fr` en français et `_converted` en anglais.

## Paramètres régionaux

Une extension n'a pas accès aux paramètres régionaux de Windows. Le mode « Suivre la langue du navigateur » utilise la locale de Chrome (`fr-FR` donne `;`, `,` et `JJ/MM/AAAA`). Si Chrome est en anglais sur un Windows français, passer en mode manuel.

## Limites connues

- Les exports déclenchés par un **POST** (formulaire) ne peuvent pas être rejoués : l'extension le signale et ne crée pas de copie.
- Les URL **à usage unique** autres qu'Oracle APEX peuvent échouer à la relecture (nouvelles règles à ajouter dans `isOneTimeDownloadUrl`, présente dans `page-hook.js` et `urls.js`).
- La copie est enregistrée dans le dossier de téléchargement par défaut, même si l'original a été enregistré ailleurs via « Enregistrer sous ».
- Années sur 2 chiffres : `00-49` → `20xx`, `50-99` → `19xx` (règle `RR` d'Oracle pour les dates à mois en lettres).
- Mois en lettres reconnus : abréviations Oracle en anglais (`JAN`…`DEC`) et en français (`JANV.`…`DÉC.`). Les autres langues NLS laissent la colonne intacte.
- Une fraction de seconde entièrement nulle (`.000000`) est omise en sortie.

## Contribuer

1. Ajouter un test dans `tests/engine.test.js` qui reproduit le cas (sans donnée réelle ni jeton).
2. Corriger, puis vérifier que `npm test` et `npm run check` passent. GitHub Actions les relance à chaque push.
3. Tout nouveau texte d'interface va dans `src/lib/i18n.js`, en français **et** en anglais.

## Tests

```bash
npm test                      # 42 tests unitaires du moteur (Node 18+)
npm run check                 # vérification syntaxique
python tests/e2e/e2e.py       # bout en bout dans Chromium (requiert Playwright)
```

Le test de bout en bout lance un site local avec un export `blob:` révoqué immédiatement, un export `https:` en Windows-1252 et une simulation de rapport interactif Oracle APEX à fichier unique. Il vérifie octet par octet les copies produites, et que le fichier APEX n'est demandé qu'une seule fois au serveur.

## Licence

[MIT](LICENSE). Vous pouvez utiliser, modifier et redistribuer ce code librement, y compris commercialement, à condition de conserver la mention de copyright. Le logiciel est fourni sans garantie.
