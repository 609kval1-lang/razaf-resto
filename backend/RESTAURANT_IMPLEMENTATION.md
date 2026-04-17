# 🏪 Restructuration Restaurant - Guide d'implémentation

## 📊 Changements effectués

### Backend (Laravel)

#### 1. **Nouvelles Tables**
- ✅ `ingredients` - Gestion des ingrédients avec stock
- ✅ `product_ingredients` - Relation produits ↔ ingrédients

#### 2. **Nouveaux Modèles**
- `App\Models\Ingredient` - Modèle pour ingrédients
- Relation `ingredients()` ajoutée au modèle `Product`

#### 3. **Nouveaux Contrôleurs**
- `IngredientController` - CRUD des ingrédients
- `CashierDashboardController` - Gestion de la caisse
- `ServerDashboardController` - Affichage produits pour serveurs

#### 4. **Nouvelles Routes API**
```
GET    /api/ingredients
POST   /api/ingredients
GET    /api/ingredients/{id}
PUT    /api/ingredients/{id}
DELETE /api/ingredients/{id}
GET    /api/ingredients/low-stock

GET    /api/cashier/orders
POST   /api/cashier/orders/{order}/mark-served
GET    /api/cashier/payment-summary

GET    /api/server/products/available
GET    /api/server/categories
GET    /api/server/products/{product}
```

#### 5. **Permissions par Rôle**
- 👨‍🍳 **kitchen** : voit seulement pending,preparing,ready
- 💰 **cashier** : voit seulement ready,served
- 🍽️ **server** : crée les commandes
- 📊 **manager** : vue complète
- 👨‍💼 **admin** : accès total

#### 6. **OrderPolicy Mise à Jour**
- Permission basée sur le rôle
- Kitchen peut changer les statuts
- Cashier peut marquer comme servi
- Roles: admin, employee, kitchen, cashier, server, manager

### Frontend (React)

#### 1. **Nouveaux Composants**
- `CashierDashboard.js` - 💰 Dashboard caisse
- `ServerDashboard.js` - 🍽️ Dashboard serveur
- `KitchenDashboard.js` - 🍳 Dashboard cuisine (mis à jour)

#### 2. **Routes Nouvelles**
```
/kitchen    → Dashboard cuisine (requires: admin, kitchen)
/cashier    → Dashboard caisse (requires: admin, cashier, manager)
/server     → Dashboard serveur (requires: admin, server, employee)
```

#### 3. **Navigation Adaptée**
- Menu dynamique selon le rôle
- Chaque rôle voit seulement ses fonctionnalités

---

## 🚀 Comment implémenter

### Step 1 : Exécuter les migrations

```bash
cd c:\xampp\htdocs\stock-management

# Exécuter les nouvelles migrations
php artisan migrate

# Ou si vous devez rollback d'abord :
# php artisan migrate:refresh
```

### Step 2 : Exécuter les seeders

```bash
# Charger les données de restaurant (catégories, ingrédients, produits)
php artisan db:seed --class=RestaurantSeeder

# Ou si vous avez DatabaseSeeder, ajouter cet appel :
# php artisan db:seed
```

### Step 3 : Créer des utilisateurs avec les nouveaux rôles

**Ajouter en base de données ou via commande :**

```php
// Via tinker
php artisan tinker

User::create([
    'name' => 'Jean Cuisine',
    'email' => 'kitchen@restaurant.test',
    'password' => Hash::make('password'),
    'role' => 'kitchen',
]);

User::create([
    'name' => 'Marie Caisse',
    'email' => 'cashier@restaurant.test',
    'password' => Hash::make('password'),
    'role' => 'cashier',
]);

User::create([
    'name' => 'Pierre Serveur',
    'email' => 'server@restaurant.test',
    'password' => Hash::make('password'),
    'role' => 'server',
]);

User::create([
    'name' => 'Admin Restaurant',
    'email' => 'admin@restaurant.test',
    'password' => Hash::make('password'),
    'role' => 'admin',
]);
```

### Step 4 : Redémarrer les serveurs

```bash
# Frontend (si c'était arrêté)
# npm start

# Backend
php artisan serve
```

---

## 📋 Structure Restaurant Implémentée

### Catégories
- 🍝 Pâtes (Bolognaise, Carbonara, etc.)
- 🍕 Pizzas (Margherita, Pepperoni, etc.)
- 🍔 Burgers (Classic, Double, etc.)
- 🥤 Boissons (Coca, Jus, Eau, etc.)
- 🍰 Desserts

### Ingrédients Pré-chargés
- Pâtes fraîches, Sauce Bolognaise, Sauce Carbonara
- Pâte à pizza, Sauce Tomate, Fromage Mozzarella, Pepperoni
- Buns, Steak haché, Laitue, Tomate
- Boissons en bouteille

### Produits Pré-chargés
- Pâtes Bolognaise (12.99€)
- Pâtes Carbonara (13.99€)
- Pizza Margherita (11.99€)
- Pizza Pepperoni (14.99€)
- Classic Burger (10.99€)
- Double Burger (14.99€)
- Boissons (1.50€ - 2.50€)

---

## 🎯 Flux de Travail Restaurant

```
1. SERVEUR 🍽️
   └─ Prend la commande (/server)
   └─ Envoie à la cuisine

2. CUISINE 👨‍🍳
   └─ Voit la commande (/kitchen)
   └─ pending → preparing → ready

3. CAISSE 💰
   └─ Voit commande prête (/cashier)
   └─ Encaisse le paiement
   └─ Marque ready → served

4. ADMIN 📊
   └─ Vue complète sur tous les dashboards
   └─ Gère ingrédients, produits, catégories
   └─ Voir les revenus

5. MANAGER 📈
   └─ Voir kitchen + cashier
   └─ Gérer les annulations
```

---

## 🔐 Permissions Détaillées

### Créer Commande
✅ admin, employee, server, manager

### Voir Commandes
- ✅ admin : TOUTES
- ✅ kitchen : seulement pending, preparing, ready
- ✅ cashier : seulement ready, served
- ✅ autres : seulement les leurs

### Changer Statut
✅ admin, kitchen, cashier, manager

### Annuler Commande
✅ admin (toujours)
✅ manager (si pas servie)
✅ créateur (si pending)

### Gérer Ingrédients
✅ admin seulement

---

## 🐛 Dépannage

**Erreur : "Table not found"**
→ Exécuter `php artisan migrate`

**Erreur : Pas de données de restaurant**
→ Exécuter `php artisan db:seed --class=RestaurantSeeder`

**Erreur : Rôle non reconnu**
→ Vérifier que l'utilisateur a un rôle valide en base

**Frontend : Menu non mis à jour**
→ Vérifier le rôle de l'utilisateur dans le profil

---

## 📱 URLs Frontend par Rôle

| Rôle | URLs Accessibles |
|------|------------------|
| **admin** | /dashboard, /kitchen, /cashier, /server, /products, /categories, /suppliers, /customers |
| **kitchen** | /kitchen |
| **cashier** | /cashier |
| **server** | /server, /kitchen (voir), /products (lire) |
| **manager** | /kitchen, /cashier, /dashboard |
| **employee** | /dashboard, /server |

---

## ✅ Checklist de Vérification

- [ ] Migrations exécutées
- [ ] Seeder RestaurantSeeder exécuté
- [ ] Utilisateurs kitchen, cashier, server créés
- [ ] Frontend compilé et testé
- [ ] Peut créer une commande en tant que serveur
- [ ] Cuisine voit les commandes
- [ ] Caisse voit les commandes prêtes
- [ ] Admin voit tout

---

**C'est bon, tu es prêt pour tester ! 🎉**
