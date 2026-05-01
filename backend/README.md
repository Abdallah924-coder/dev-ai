# DevAI

DevAI est une application IA avec frontend statique et backend Node/Express. Le projet gère l'authentification, le chat multi-mode, la mémoire utilisateur, le Deep Research, les quotas de messages, les demandes de paiement manuelles et une interface admin de validation.

## Structure

```text
devAI/
├── .gitignore
├── backend/
│   ├── .env.example
│   ├── middleware/
│   ├── models/
│   ├── routes/
│   ├── services/
│   ├── uploads/
│   ├── utils/
│   ├── package.json
│   └── server.js
└── frontend/
    ├── index.html
    ├── app.html
    ├── payment.html
    ├── admin.html
    ├── app.js
    ├── payment.js
    ├── admin.js
    └── style.css
```

## Fonctionnalités

- Authentification JWT avec onboarding.
- Conversations persistées dans MongoDB.
- Modes `standard`, `code`, `math`, `deep_research`.
- Mémoire utilisateur heuristique.
- Recherche web optionnelle avec Tavily.
- Limites d'usage:
  - `5` messages maximum par minute et par utilisateur.
  - `20` messages gratuits par fenêtre de `5` heures.
  - messages entrants limités à `1500` caractères.
- Plans payants manuels via MTN Mobile Money:
  - `1$ / 650 FCFA -> 100 messages`
  - `2$ / 1300 FCFA -> 300 messages`
  - `5$ / 3250 FCFA -> 1000 messages`
  - `3$ / mois -> 500 messages`
  - `5$ / mois -> 1500 messages`
- Page admin pour approuver ou rejeter les paiements.
- E-mails admin + utilisateur pour les demandes, validations et OTP.

## Installation

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
```

### 2. Variables d'environnement

Renseigner au minimum:

```env
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb+srv://...
JWT_SECRET=...
JWT_EXPIRES_IN=30d
ADMIN_PASSWORD=...
ADMIN_JWT_SECRET=...
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-sonnet-4-20250514
WEB_RESEARCH_ENABLED=false
WEB_RESEARCH_PROVIDER=tavily
TAVILY_API_KEY=tvly-...
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=...
EMAIL_PASS=...
EMAIL_FROM=DevAI <votre-email@gmail.com>
CONTACT_RECEIVER_EMAIL=votre-boite-admin@gmail.com
FRONTEND_URL=http://localhost:3000
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

Variables importantes:

- `MONGODB_URI`: obligatoire.
- `JWT_SECRET`: obligatoire.
- `ADMIN_PASSWORD`: mot de passe de la page admin.
- `ADMIN_JWT_SECRET`: recommandé pour séparer les sessions admin.
- `ANTHROPIC_API_KEY`: obligatoire pour le chat.
- `BREVO_API_KEY`: recommandé sur Render pour contourner le blocage SMTP.
- `EMAIL_HOST`, `EMAIL_USER`, `EMAIL_PASS`: utilisés seulement si vous gardez le fallback SMTP.
- `EMAIL_FROM`: adresse d’expéditeur visible par les utilisateurs.
- `CONTACT_RECEIVER_EMAIL`: boîte qui reçoit les messages de contact et les alertes admin.
- `EMAIL_OTP_LENGTH`: longueur du code OTP e-mail. Valeur courante: `6`.
- `EMAIL_OTP_TTL_MINUTES`: durée de validité du code OTP. Valeur courante: `10`.

Si vous déployez sur Render, le plus simple est:
- `BREVO_API_KEY`: la clé API Brevo générée dans votre compte Brevo.
- `EMAIL_FROM`: un expéditeur validé chez Brevo, par exemple `DevAI <no-reply@votre-domaine.com>`.
- `CONTACT_RECEIVER_EMAIL`: votre boîte admin réelle, celle qui recevra les contacts et les notifications.
- `FRONTEND_URL`: l’URL publique du frontend, par exemple `https://votre-site.com` ou `https://votre-app.onrender.com`.
- `ALLOWED_ORIGINS`: la liste des origines web autorisées à appeler l’API.

Si vous restez en SMTP local:
- remplissez `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`;
- laissez `BREVO_API_KEY` vide;
- gardez `EMAIL_FROM` sur une adresse liée au serveur SMTP utilisé.

### 3. Lancement

```bash
cd backend
npm run dev
```

Le frontend peut être servi statiquement sur `http://localhost:3000`.

## Pages frontend

- `index.html`: landing page.
- `app.html`: application principale.
- `payment.html`: page de paiement et soumission de preuve.
- `admin.html`: interface admin.

## Connexion admin

La page admin est accessible via:

```text
/admin.html
```

Pour te connecter:

1. définis `ADMIN_PASSWORD` dans `backend/.env`
2. démarre le backend
3. ouvre `admin.html`
4. saisis le mot de passe admin

Une fois connecté, tu peux:

- voir les demandes en attente
- ouvrir la preuve de paiement
- approuver un plan
- rejeter une demande avec note admin

## Paiement manuel

Le bénéficiaire affiché côté utilisateur est:

- Numéro: `+242 06 668 94 48`
- Nom: `MICHY MAGELLAN DEVOUE LI-MBOUITY`

Quand l'utilisateur atteint sa limite:

1. le chat bloque l'envoi
2. le bouton de recharge apparaît
3. l'utilisateur ouvre `payment.html`
4. il choisit un plan
5. il joint une preuve de paiement
6. l'admin reçoit une notification
7. l'admin valide ou rejette depuis `admin.html`

## Rendu des maths

Le frontend charge KaTeX pour rendre les expressions mathématiques. Les réponses IA contenant du LaTeX entre `$...$`, `$$...$$`, `\(...\)` ou `\[...\]` sont rendues visuellement dans le chat.

## API principale

Routes utilisateur:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `PUT /api/auth/profile`
- `PUT /api/auth/onboarding`
- `POST /api/chat`
- `GET /api/chat/memory`
- `GET /api/conversations`
- `POST /api/conversations`
- `GET /api/billing/status`
- `POST /api/billing/payment-requests`

Routes admin:

- `POST /api/admin/login`
- `GET /api/admin/overview`
- `GET /api/admin/payment-requests`
- `GET /api/admin/payment-requests/:id/proof`
- `POST /api/admin/payment-requests/:id/approve`
- `POST /api/admin/payment-requests/:id/reject`

## Préparation GitHub

Le projet ignore déjà les fichiers sensibles et lourds via `.gitignore`, notamment:

- `backend/.env`
- `backend/node_modules/`
- `backend/uploads/payment-proofs/`

Avant de pousser:

```bash
cd /home/dona/devAI
git init
git status
```

Vérifie que `.env`, `node_modules` et les preuves de paiement n'apparaissent pas dans `git status`.

### Activer la recherche web

Le backend supporte actuellement `Tavily`.

Configuration minimale :

```env
WEB_RESEARCH_ENABLED=true
WEB_RESEARCH_PROVIDER=tavily
TAVILY_API_KEY=tvly-...
```

Quand la recherche web est active :
1. le backend interroge Tavily avec le message utilisateur ;
2. il récupère jusqu'à 5 résultats ;
3. il injecte titres, URLs et extraits dans le prompt système ;
4. il renvoie aussi ces sources dans la réponse API.

Si la recherche web est activée mais mal configurée :
- le backend ne casse pas le chat ;
- il continue sans sources externes ;
- l'objet `webResearch` dans la réponse indique l'erreur de configuration.

Ce que ce mode ne fait pas encore :
- interrogation d'une base documentaire externe ;
- RAG vectoriel ;
- exécution d'outils externes.

Autrement dit, le mode `deep_research` peut déjà s'appuyer sur le web, mais il n'est pas encore connecté à un RAG documentaire interne ni à un système d'outils plus large.

## E-mails

Le module [`utils/email.js`](./utils/email.js) gère :
- l'e-mail de bienvenue ;
- l'e-mail de réinitialisation de mot de passe.
- l'e-mail de vérification OTP à l'inscription ;
- l'e-mail OTP de réinitialisation du mot de passe ;
- les notifications admin et utilisateur liées aux paiements.

Sur Render, l’envoi prioritaire passe par l’API HTTP Brevo via `BREVO_API_KEY`.
Le SMTP classique ne sert qu’en fallback local si `BREVO_API_KEY` n’est pas défini.

Le flux de réinitialisation utilise maintenant un OTP envoyé par e-mail plutôt qu’un lien de type token.

Le flux d’inscription est le suivant :
1. l'utilisateur crée son compte ;
2. le backend envoie un OTP de vérification ;
3. le compte est activé seulement après validation du code.

Le flux de reset est le suivant :
1. l'utilisateur demande un code OTP ;
2. il saisit le code et son nouveau mot de passe ;
3. le backend valide le code puis met à jour le mot de passe.

## Intégration Dans Une App De Discussion

Pour intégrer DevAI dans une autre application de discussion, le point d’entrée principal est `POST /api/chat`.

Séquence recommandée :
1. authentifier l’utilisateur avec `POST /api/auth/register` puis `POST /api/auth/verify-email`, ou `POST /api/auth/login` ;
2. stocker le JWT retourné côté client ;
3. créer ou charger une conversation via `POST /api/conversations` et `GET /api/conversations` ;
4. envoyer les messages avec `POST /api/chat` ;
5. récupérer l’état d’usage via `GET /api/billing/status` pour afficher les quotas.

Le backend renvoie aussi des métadonnées utiles pour une interface de chat moderne :
- `mode`
- `intent`
- `researchPlan`
- `webResearch`
- `usage`
- `billingSource`

Exemple minimal d’envoi de message :

```js
await fetch('/api/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    conversationId,
    message: 'Explique cette erreur React.',
    mode: 'code',
  }),
});
```

Pour une app de discussion custom, il faut surtout gérer :
- l’état du JWT ;
- l’ID de conversation ;
- l’affichage des quotas ;
- la navigation vers `payment.html` quand `usage.blocked` devient vrai.

## Sécurité

Le backend inclut :
- `helmet` pour les headers HTTP ;
- `cors` par liste blanche ;
- un rate limiting global ;
- un rate limiting plus strict pour l'auth ;
- un middleware JWT ;
- des mots de passe hashés avec `bcrypt`.

## Réponses API utiles

### `POST /api/chat`

Réponse typique :

```json
{
  "reply": "Voici l'analyse...",
  "conversationId": "662...",
  "title": "Explique-moi cette erreur Express",
  "mode": "code",
  "intent": "debug",
  "researchPlan": [
    "Identifier le langage, le framework et le comportement attendu.",
    "Repérer les causes possibles ou les architectures adaptées.",
    "Comparer correctif rapide, solution robuste et bonnes pratiques.",
    "Fournir du code ou des étapes de test si nécessaire."
  ],
  "webResearch": {
    "performed": true,
    "provider": "tavily",
    "error": null,
    "sources": [
      {
        "rank": 1,
        "title": "Express error handling guide",
        "url": "https://example.com/express-errors",
        "snippet": "..."
      }
    ]
  }
}
```

## Roadmap naturelle

Cette base est prête pour les prochaines étapes :
- mémoire enrichie par le modèle lui-même ;
- RAG documentaire ;
- recherche web supervisée ;
- outils serveur ;
- streaming des réponses ;
- évaluation qualité et observabilité.

## Fichiers clés

- [`server.js`](./server.js) : bootstrap Express, sécurité, MongoDB.
- [`routes/auth.js`](./routes/auth.js) : auth et e-mails.
- [`routes/chat.js`](./routes/chat.js) : entrée principale de l'IA.
- [`services/chatOrchestrator.js`](./services/chatOrchestrator.js) : choix du mode, intention, prompt, plan de recherche.
- [`services/memoryService.js`](./services/memoryService.js) : extraction et persistance de la mémoire.
- [`models/UserMemory.js`](./models/UserMemory.js) : mémoire long terme simplifiée.
- [`models/Conversation.js`](./models/Conversation.js) : historique + métadonnées conversationnelles.

## Limites actuelles

À ce stade :
- la mémoire est simple mais déjà persistante ;
- le mode `deep_research` peut enrichir la réponse avec le web si la clé fournisseur est configurée ;
- il n'y a pas encore de RAG ni d'outils d'action ;
- le frontend n'expose pas encore un sélecteur de mode, mais l'API le supporte déjà.
