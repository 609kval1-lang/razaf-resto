# Guide CRUD Produit

## Description
Ce document décrit les endpoints API pour gérer les produits. Chaque produit doit avoir:
- **Catégorie** (category_id) - Référence à la table catégories
- **Désignation** (designation) - Nom du produit
- **Description** (description) - Description détaillée du produit
- **Prix** (price) - Prix du produit (décimal avec 2 décimales)

## Structure de la base de données

### Table: categories
- id (INT, Primary Key)
- name (VARCHAR, Unique)
- timestamps

### Table: products
- id (INT, Primary Key)
- category_id (INT, Foreign Key) - Référence à categories.id
- designation (VARCHAR)
- description (TEXT)
- price (DECIMAL 10,2)
- timestamps

## Endpoints API

Base URL: `http://localhost/stock-management/api`

### 1. Obtenir tous les produits
**Méthode:** `GET`
**URL:** `/products`
**Description:** Récupère la liste de tous les produits avec leurs catégories

**Réponse (200):**
```json
[
  {
    "id": 1,
    "category_id": 1,
    "designation": "Laptop",
    "description": "Ordinateur portable haute performance",
    "price": "999.99",
    "created_at": "2026-03-04T10:30:00Z",
    "updated_at": "2026-03-04T10:30:00Z",
    "category": {
      "id": 1,
      "name": "Électronique",
      "created_at": "2026-03-04T10:00:00Z",
      "updated_at": "2026-03-04T10:00:00Z"
    }
  }
]
```

### 2. Créer un produit
**Méthode:** `POST`
**URL:** `/products`
**Description:** Crée un nouveau produit

**Corps de la requête:**
```json
{
  "category_id": 1,
  "designation": "Laptop",
  "description": "Ordinateur portable haute performance avec processeur dernière génération",
  "price": 999.99
}
```

**Réponse (201):**
```json
{
  "message": "Produit créé avec succès",
  "product": {
    "id": 1,
    "category_id": 1,
    "designation": "Laptop",
    "description": "Ordinateur portable haute performance avec processeur dernière génération",
    "price": "999.99",
    "created_at": "2026-03-04T10:30:00Z",
    "updated_at": "2026-03-04T10:30:00Z",
    "category": {
      "id": 1,
      "name": "Électronique"
    }
  }
}
```

### 3. Obtenir un produit
**Méthode:** `GET`
**URL:** `/products/{id}`
**Description:** Récupère les détails d'un produit spécifique

**Réponse (200):**
```json
{
  "id": 1,
  "category_id": 1,
  "designation": "Laptop",
  "description": "Ordinateur portable haute performance",
  "price": "999.99",
  "created_at": "2026-03-04T10:30:00Z",
  "updated_at": "2026-03-04T10:30:00Z",
  "category": {
    "id": 1,
    "name": "Électronique"
  }
}
```

### 4. Afficher le formulaire d'édition (optionnel)
**Méthode:** `GET`
**URL:** `/products/{id}/edit`
**Description:** Récupère les données du produit et la liste des catégories pour édition

**Réponse (200):**
```json
{
  "product": {
    "id": 1,
    "category_id": 1,
    "designation": "Laptop",
    "description": "Ordinateur portable haute performance",
    "price": "999.99",
    "created_at": "2026-03-04T10:30:00Z",
    "updated_at": "2026-03-04T10:30:00Z",
    "category": {
      "id": 1,
      "name": "Électronique"
    }
  },
  "categories": [
    {"id": 1, "name": "Électronique"},
    {"id": 2, "name": "Vêtements"},
    {"id": 3, "name": "Alimentation"},
    {"id": 4, "name": "Mobilier"},
    {"id": 5, "name": "Livres"}
  ]
}
```

### 5. Mettre à jour un produit
**Méthode:** `PUT`
**URL:** `/products/{id}`
**Description:** Met à jour un produit existant

**Corps de la requête:**
```json
{
  "category_id": 2,
  "designation": "Laptop Gaming",
  "description": "Ordinateur portable gaming haute performance",
  "price": 1299.99
}
```

**Réponse (200):**
```json
{
  "message": "Produit mis à jour avec succès",
  "product": {
    "id": 1,
    "category_id": 2,
    "designation": "Laptop Gaming",
    "description": "Ordinateur portable gaming haute performance",
    "price": "1299.99",
    "created_at": "2026-03-04T10:30:00Z",
    "updated_at": "2026-03-04T11:45:00Z",
    "category": {
      "id": 2,
      "name": "Vêtements"
    }
  }
}
```

### 6. Supprimer un produit
**Méthode:** `DELETE`
**URL:** `/products/{id}`
**Description:** Supprime un produit

**Réponse (200):**
```json
{
  "message": "Produit supprimé avec succès"
}
```

## Validation

Les champs suivants sont validés lors de la création/mise à jour:
- **category_id**: Obligatoire, doit exister dans la table categories
- **designation**: Obligatoire, chaîne de caractères, max 255 caractères
- **description**: Obligatoire, chaîne de caractères
- **price**: Obligatoire, numérique, minimum 0

## Erreurs courantes

### 422 Unprocessable Entity
Erreur de validation - Vérifiez les champs requis

### 404 Not Found
Le produit ou la catégorie n'existe pas

### 500 Internal Server Error
Erreur serveur - Vérifiez les logs

## Catégories disponibles
1. Électronique
2. Vêtements
3. Alimentation
4. Mobilier
5. Livres
