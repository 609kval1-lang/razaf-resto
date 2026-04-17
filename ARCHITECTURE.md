# 🏪 RAZAF RESTO - Architecture Complète

## 📊 Structure Base de Données

```
🧊 raw_materials (Matières brutes - Congélateur)
├─ Riz 50kg | Poulet 100kg | Sauce soja 10L
└─ Gérée par: Admin/Gérant

❄️ ingredients (Portions préparées - Frigo)
├─ 150 x 100g Riz | 200 x 150g Poulet | 300 x 30ml Sauce
└─ Créées à partir du stock brut

📋 menus
├─ Riz Poulet (12€) = 1 riz + 1 poulet + 1 sauce
└─ Riz Légumes (9€) = 1 riz + 2 légumes + 1 sauce

🍽️ tables
├─ Table 1 (2 places, Terrasse)
└─ Table 20 (4 places, Intérieur)

👤 customers
├─ Mohammed (Fidèle, 50 points)
└─ Ahmed (Fidèle, 100 points)

🧾 orders
├─ Status: pending → in_kitchen → ready → served → paid
├─ Table 5 ou Customer Ahmed
└─ Contient plusieurs order_items

💳 payments
├─ Cash, Card, Transfer
└─ Status: pending → completed ou refunded
```

## 🔐 Rôles & Accès

### 👨‍💼 Admin/Gérant
- ✅ Créer/Éditer/Supprimer users (Cuisine, Caisse, Serveur)
- ✅ Gérer tables (ajouter, supprimer, capacité)
- ✅ Gérer matières premières brutes
- ✅ Créer portions ingrédients
- ✅ Gérer menus & recettes
- ✅ Voir tous rapports
- ✅ Vue complète d'audit

### 🍽️ Serveur
- ✅ Voir tables libres
- ✅ Voir clients fidèles
- ✅ Créer commande (table ou client)
- ✅ Ajouter items du menu
- ✅ Soumettre commande cuisine
- ❌ Ne voit pas le backend admin

### 🍳 Cuisine
- ✅ Voir commandes en attente
- ✅ Dashboard portions disponibles
- ✅ Marquer en_kitchen, ready, served
- ✅ Voir historique commandes
- ❌ Ne peut pas créer commandes

### 💰 Caissier
- ✅ Voir commandes "ready to serve"
- ✅ Voir commandes "served"
- ✅ Traiter paiements
- ✅ Générer factures
- ❌ Ne voit pas les commandes en cuisine

## 📱 Interfaces Principales

### 1️⃣ Admin Panel
```
/admin
├─ Dashboard (Résumé jour)
├─ 👥 Gestion Utilisateurs
│  ├─ Lister | Créer | Éditer | Supprimer
│  └─ Rôle: Cuisine/Caisse/Serveur
│
├─ 🍽️ Gestion Tables
│  ├─ Lister | Ajouter | Éditer | Supprimer
│  ├─ Capacité, Section
│  └─ Status: free/occupied/reserved
│
├─ 🧊 Matières Premières
│  ├─ CRUD stock brut
│  └─ Suivi réapprovisionnement
│
├─ ❄️ Ingrédients (Portions)
│  ├─ Créer portions à partir du stock
│  └─ Éditer quantités disponibles
│
├─ 📋 Menus
│  ├─ CRUD plats
│  ├─ Sélectionner ingrédients + quantités
│  └─ Fixer prix
│
└─ 📊 Rapports
   ├─ Ventes jour
   ├─ Revenus
   └─ Stocks faibles
```

### 2️⃣ Serveur Dashboard
```
/server
├─ 📋 Nouvelle Commande
│  ├─ Choisir TABLE (Table 1, 2, 3...)
│  └─ OU CHOISIR CLIENT (Ahmed, Mohammed...)
│
├─ 📖 Menu Disponible
│  ├─ Afficher tous les plats
│  ├─ ✅ Indicateur "En Stock" (portions dispo)
│  └─ ❌ Indicateur "Rupture" (portions insuffisantes)
│
├─ 🛒 Panier Commande
│  ├─ Ajouter items
│  ├─ Quantité par item
│  └─ Montant total
│
├─ 💬 Requêtes Spéciales
│  └─ Champ notes (Sans oignon, etc.)
│
└─ ✅ Soumettre Commande
   └─ Envoie à cuisine (in_kitchen)
```

### 3️⃣ Kitchen Dashboard
```
/kitchen
├─ 📊 Portions Disponibles
│  ├─ Riz: 120/150 portions
│  ├─ Poulet: 45/200 portions
│  └─ ⚠️ Alerte si < 10% dispo
│
├─ 🧾 Commandes à Préparér
│  ├─ Priorité: is_urgent flag
│  ├─ Détails: items + quantités
│  └─ Notes spéciales
│
├─ Pour chaque Commande:
│  ├─ 🔴 Pending (rouge)
│  ├─ 🟡 In Kitchen (jaune)
│  ├─ 🟢 Ready (vert)
│  └─ Boutons: Start → Mark Ready
│
└─ 📈 Stats Temps Réel
   ├─ Commandes en cours
   ├─ Temps moyen préparation
   └─ Items prêts
```

### 4️⃣ Caisse Dashboard
```
/cashier
├─ 📋 Commandes Prêtes
│  └─ Voir uniquement status = "ready" ou "served"
│
├─ Pour chaque Commande:
│  ├─ Client: Table X ou Nom Client
│  ├─ Items listés
│  ├─ Montant total
│  └─ 🔘 Bouton "Encaisser"
│
├─ 💳 Mode Paiement
│  ├─ Cash ← Défaut
│  ├─ Card
│  ├─ Transfer
│  └─ Check
│
├─ 🧾 Facture
│  └─ Générée automatiquement
│
└─ 📊 Caisse du Jour
   ├─ Total encaissé
   ├─ Par méthode
   └─ Nombre commandes
```

## 🔄 Flux Commande Complet

```
1. SERVEUR crée commande
   └─ Table 5 × Menu A (2) + Menu B (1)
   └─ Status: PENDING

2. COMMANDE → CUISINE
   └─ Status: IN_KITCHEN
   ├─ Vérifie portions dispo
   ├─ Décrémente automatiquement
   └─ Affiche sur dashboard

3. CUISINE prépare
   ├─ Marque "En cours"
   ├─ Utilise recette (ingrédients)
   └─ Status: PREPARING

4. PLATS PRÊTS
   └─ Status: READY

5. SERVEUR → CAISSE
   └─ Livraison table
   └─ Status: SERVED

6. CAISSE traite paiement
   └─ Choix mode paiement
   └─ Status: PAID & ARCHIVED
```

## 📊 Tables Relationnelles

| Table | Rôle | Clés |
|-------|------|------|
| `users` | Authentification & Rôles | id, role, email |
| `raw_materials` | Stock brut | id, stock, unit |
| `ingredients` | Portions frigo | id, raw_material_id, quantity_available |
| `menus` | Plats disponibles | id, price, is_available |
| `menu_ingredients` | Recettes | menu_id, ingredient_id, quantity_needed |
| `tables` | Tables physiques | id, table_number, capacity, status |
| `customers` | Clients fidèles | id, name, loyalty_points |
| `orders` | Commandes | id, table_id/customer_id, status, user_id |
| `order_items` | Items/Ligne order | id, order_id, menu_id, quantity, status |
| `payments` | Paiements | id, order_id, amount, method, status |
| `action_logs` | Audit complet | id, user_id, action, entity_type, changes |

## 🚀 Setup Initial

### Backend (Laravel)
```bash
# 1. Migration BD
php artisan migrate

# 2. Seeder données de test
php artisan db:seed

# 3. Server
php artisan serve

# 4. Backend API: http://localhost:8000/api
```

### Frontend (React)
```bash
# 1. Installer
npm install

# 2. Dev server
npm start

# 3. Frontend: http://localhost:3000
```

## ✅ Checklist Implémentation

- [ ] Migrations & Tables BD
- [ ] Modèles Eloquent
- [ ] Seeders données test
- [ ] Contrôleurs API (Admin, Serveur, Cuisine, Caisse)
- [ ] Routes API
- [ ] Authentification & Autorisation
- [ ] React Components (Admin, Serveur, Cuisine, Caisse)
- [ ] Intégration API/React
- [ ] Tests unitaires
- [ ] Documentation API
