# DevAI

DevAI est une application IA pensée pour la programmation, les mathématiques et la recherche approfondie. Le projet contient un frontend statique et un backend Node/Express avec MongoDB.

## Points clés

- Authentification JWT
- Chat IA avec modes `standard`, `code`, `math`, `deep_research`
- Mémoire utilisateur
- Recherche web optionnelle
- Quotas de messages et crédits payants
- Paiement manuel par MTN Mobile Money
- Interface admin de validation
- Notifications e-mail admin et utilisateur

## Dossiers

- `frontend/` : pages HTML, CSS et JS
- `backend/` : API Express, modèles MongoDB, services, e-mails

## Pages

- `frontend/index.html`
- `frontend/app.html`
- `frontend/payment.html`
- `frontend/admin.html`

## Installation rapide

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

Consulte ensuite [backend/README.md](./backend/README.md) pour la configuration complète, les variables d'environnement, la connexion admin et le flux de paiement.

## GitHub

Le dépôt est préparé pour ne pas envoyer:

- `.env`
- `node_modules`
- `uploads/payment-proofs`

Le fichier racine `.gitignore` s'en charge déjà.
