# 🏪 Razafimamonjy Restaurant - Guide d'Installation

## 📋 Prérequis

- XAMPP (Apache + PHP 8.1+)
- Composer
- Node.js & npm
- MySQL 8.0+

## 🚀 Configuration Backend (Laravel)

### 1️⃣ Préparation
```bash
cd c:\xampp\htdocs\razaf-resto\backend

# Copier le fichier .env
copy .env.example .env

# Générer la clé APP
php artisan key:generate
```

### 2️⃣ Configuration Base de Données (.env)
```
DB_DATABASE=razaf_resto
DB_USERNAME=root
DB_PASSWORD=
```

### 3️⃣ Créer Base de Données
```bash
# Via MySQL
mysql -u root
CREATE DATABASE razaf_resto;
EXIT;
```

### 4️⃣ Migrations & Seed
```bash
# Exécuter les migrations
php artisan migrate

# Populate avec données de test
php artisan db:seed --class=RazafRestoSeeder
```

### 5️⃣ Lancer le Serveur
```bash
php artisan serve
# Backend API: http://localhost:8000/api
```

## 🎨 Configuration Frontend (React)

### 1️⃣ Préparation
```bash
cd c:\xampp\htdocs\razaf-resto\frontend

# Installer les dépendances
npm install
```

### 2️⃣ Variables d'Environnement (.env)
Créer `.env` :
```
REACT_APP_API_URL=http://localhost:8000/api
```

### 3️⃣ Lancer le Frontend
```bash
npm start
# Frontend: http://localhost:3000
```

## 👥 Utilisateurs de Test

### Après db:seed, vous pouvez vous connecter avec :

```
Email: admin@razaf.com
Password: admin123
Rôle: Admin

---

Email: server@razaf.com
Password: server123
Rôle: Serveur

---

Email: kitchen@razaf.com
Password: kitchen123
Rôle: Cuisine

---

Email: cashier@razaf.com
Password: cashier123
Rôle: Caissier
```

## 📊 Routes API Disponibles

### 🔓 Publiques (non authentifiées)
```
POST   /api/register
POST   /api/login
```

### 🔐 Protégées (authentifiées)

#### 👨‍💼 Admin (`/api/admin/*`)
```
GET    /admin/users                    - Lister utilisateurs
POST   /admin/users                    - Créer utilisateur
PUT    /admin/users/{user}             - Éditer utilisateur
DELETE /admin/users/{user}             - Supprimer

GET    /admin/tables                   - Lister tables
POST   /admin/tables                   - Ajouter table
PUT    /admin/tables/{table}           - Éditer table
DELETE /admin/tables/{table}           - Supprimer table

GET    /admin/raw-materials            - Stock brut
POST   /admin/raw-materials            - Ajouter
PUT    /admin/raw-materials/{id}       - Éditer

GET    /admin/ingredients              - Portions frigo
POST   /admin/ingredients              - Créer portion
PUT    /admin/ingredients/{id}         - Éditer portion

GET    /admin/menus                    - Lister menus
POST   /admin/menus                    - Créer menu
PUT    /admin/menus/{menu}             - Éditer menu
DELETE /admin/menus/{menu}             - Supprimer menu
```

#### 🍽️ Serveur (`/api/server/*`)
```
GET    /server/tables                  - Tables libres
GET    /server/customers               - Clients fidèles
GET    /server/menus                   - Menu avec portions
POST   /server/orders                  - Créer commande
GET    /server/my-orders               - Mes commandes
```

#### 🍳 Cuisine (`/api/kitchen/*`)
```
GET    /kitchen/ingredients            - État portions
GET    /kitchen/orders                 - Commandes en attente
POST   /kitchen/orders/{order}/start   - Marquer "En cours"
POST   /kitchen/orders/{order}/ready   - Marquer "Prêt"
GET    /kitchen/history                - Historique
GET    /kitchen/stats                  - Statistiques
```

#### 💰 Caisse (`/api/cashier/*`)
```
GET    /cashier/orders                 - Commandes prêtes
POST   /cashier/orders/{order}/payment - Traiter paiement
GET    /cashier/stats                  - Statistiques jour
GET    /cashier/invoice/{order}        - Facture
GET    /cashier/history                - Historique paiements
```

## 🔍 Tester l'API avec Postman/Insomnia

### 1️⃣ Login
```
POST http://localhost:8000/api/login
Body (JSON):
{
  "email": "admin@razaf.com",
  "password": "admin123"
}
```

### 2️⃣ Ajouter Token
- Dans les Headers de toutes les requêtes protégées :
```
Authorization: Bearer {token_reçu}
```

### 3️⃣ Essayer une route Admin
```
GET http://localhost:8000/api/admin/tables
Headers: Authorization: Bearer {token}
```

## 💾 Sauvegarder/Restaurer Base de Données

### Sauvegarder
```bash
mysqldump -u root razaf_resto > backuprazaf.sql
```

### Restaurer
```bash
mysql -u root razaf_resto < backup_razaf.sql
```

## 🐛 Dépannage

### "SQLSTATE[HY000]: General error"
```bash
php artisan cache:clear
php artisan config:clear
php artisan migrate:refresh --seed
```

### Problèmes d'authentification
- Vérifier le `.env` DB_HOST=127.0.0.1 (pas localhost)
- Vérifier sanctum middleware dans `bootstrap/app.php`

### Erreur Port 8000 occupé
```bash
php artisan serve --port=8001
```

### Erreur NPM packages
```bash
cd frontend
rm -r node_modules
npm install
```

## 📱 Architectures des Composants

### Hiérarchie des fichiers Suggestion:
```
razaf-resto/
├── backend/                 (Laravel API)
│   ├── app/
│   │   ├── Http/Controllers/Api/
│   │   │   ├── AdminController.php
│   │   │   ├── ServerController.php
│   │   │   ├── KitchenController.php
│   │   │   └── CashierController.php
│   │   ├── Models/
│   │   │   ├── RawMaterial.php
│   │   │   ├── Ingredient.php
│   │   │   ├── Menu.php
│   │   │   ├── Order.php
│   │   │   ├── ...
│   ├── database/
│   │   ├── migrations/
│   │   └── seeders/
│   └── routes/api.php
│
├── frontend/                (React)
│   ├── src/
│   │   ├── components/
│   │   │   ├── AdminPanel/
│   │   │   ├── ServerDashboard/
│   │   │   ├── KitchenDashboard/
│   │   │   └── CashierDashboard/
│   │   ├── pages/
│   │   ├── services/api.js
│   │   └── App.js
│
└── ARCHITECTURE.md          (Cette doc)
```

## ✅ Checklist Démarrage

- [x] Dossiers créés
- [x] Backend Laravel initialisé
- [x] Migrations créées
- [x] Modèles définis
- [x] Contrôleurs API créés
- [x] Routes configurées
- [x] Seeder préparé
- [ ] Frontend React à initialiser
- [ ] Composants React à créer
- [ ] Tester les routes API
- [ ] Intégration Frontend/Backend
- [ ] Tests unitaires
- [ ] Déploiement

## 🎯 Prochaines Étapes

1. **Frontend React** - Créer les 4 dashboards (Admin, Serveur, Cuisine, Caisse)
2. **Tests unitaires** - Valider les routes API
3. **Authentification** - Implémenter tokens JWT
4. **Notifications** - WebSocket pour mises à jour en temps réel
5. **Rapports** - Exports PDF/Excel

---

Pour plus d'aide : consultez [ARCHITECTURE.md](./ARCHITECTURE.md)
