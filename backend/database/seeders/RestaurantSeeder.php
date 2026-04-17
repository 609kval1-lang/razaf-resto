<?php

namespace Database\Seeders;

use App\Models\Category;
use App\Models\Product;
use App\Models\Ingredient;
use Illuminate\Database\Seeder;

class RestaurantSeeder extends Seeder
{
    public function run(): void
    {
        $ingredients = [
            // Sauces de base
            ['name' => 'Sauce soja', 'cost' => 1.20, 'stock' => 80, 'unit' => 'L', 'reorder_level' => 10],
            ['name' => 'Sauce huître', 'cost' => 1.50, 'stock' => 60, 'unit' => 'L', 'reorder_level' => 8],
            ['name' => 'Sauce Sriracha', 'cost' => 1.80, 'stock' => 40, 'unit' => 'L', 'reorder_level' => 5],
            ['name' => 'Sauce haricot noir', 'cost' => 2.00, 'stock' => 40, 'unit' => 'L', 'reorder_level' => 5],
            ['name' => 'Sauce aigre-douce', 'cost' => 1.60, 'stock' => 50, 'unit' => 'L', 'reorder_level' => 6],
            ['name' => 'Huile sésame', 'cost' => 3.50, 'stock' => 30, 'unit' => 'L', 'reorder_level' => 4],
            ['name' => 'Vinaigre riz', 'cost' => 1.40, 'stock' => 50, 'unit' => 'L', 'reorder_level' => 6],
            ['name' => 'Ail frais', 'cost' => 0.80, 'stock' => 50, 'unit' => 'kg', 'reorder_level' => 8],
            ['name' => 'Gingembre frais', 'cost' => 1.20, 'stock' => 40, 'unit' => 'kg', 'reorder_level' => 6],
            ['name' => 'Oignons verts', 'cost' => 0.60, 'stock' => 60, 'unit' => 'kg', 'reorder_level' => 8],
            ['name' => 'Riz basmati', 'cost' => 1.50, 'stock' => 150, 'unit' => 'kg', 'reorder_level' => 20],
            ['name' => 'Nouilles œuf', 'cost' => 2.00, 'stock' => 100, 'unit' => 'kg', 'reorder_level' => 15],
            ['name' => 'Nouilles de riz', 'cost' => 1.80, 'stock' => 80, 'unit' => 'kg', 'reorder_level' => 12],
            ['name' => 'Nouilles croustillantes', 'cost' => 2.50, 'stock' => 60, 'unit' => 'kg', 'reorder_level' => 8],
            ['name' => 'Poulet fermier', 'cost' => 5.50, 'stock' => 120, 'unit' => 'kg', 'reorder_level' => 15],
            ['name' => 'Porc frais', 'cost' => 4.80, 'stock' => 100, 'unit' => 'kg', 'reorder_level' => 12],
            ['name' => 'Bœuf de qualité', 'cost' => 7.50, 'stock' => 80, 'unit' => 'kg', 'reorder_level' => 10],
            ['name' => 'Crevettes fraîches', 'cost' => 8.50, 'stock' => 70, 'unit' => 'kg', 'reorder_level' => 10],
            ['name' => 'Œufs fermiers', 'cost' => 0.20, 'stock' => 300, 'unit' => 'pcs', 'reorder_level' => 50],
            ['name' => 'Tofu nature', 'cost' => 1.50, 'stock' => 80, 'unit' => 'kg', 'reorder_level' => 10],
            ['name' => 'Brocoli frais', 'cost' => 0.80, 'stock' => 100, 'unit' => 'kg', 'reorder_level' => 12],
            ['name' => 'Carotte', 'cost' => 0.40, 'stock' => 80, 'unit' => 'kg', 'reorder_level' => 10],
            ['name' => 'Chou chinois', 'cost' => 0.70, 'stock' => 100, 'unit' => 'kg', 'reorder_level' => 12],
            ['name' => 'Champignon de Paris', 'cost' => 1.20, 'stock' => 60, 'unit' => 'kg', 'reorder_level' => 8],
            ['name' => 'Poivron rouge', 'cost' => 0.90, 'stock' => 80, 'unit' => 'kg', 'reorder_level' => 10],
            ['name' => 'Poivron jaune', 'cost' => 0.90, 'stock' => 80, 'unit' => 'kg', 'reorder_level' => 10],
            ['name' => 'Germes de soja', 'cost' => 2.00, 'stock' => 50, 'unit' => 'kg', 'reorder_level' => 8],
            ['name' => 'Bambou frais', 'cost' => 1.80, 'stock' => 40, 'unit' => 'kg', 'reorder_level' => 6],
            ['name' => 'Sauce curry rouge', 'cost' => 3.00, 'stock' => 40, 'unit' => 'L', 'reorder_level' => 5],
            ['name' => 'Lait de coco', 'cost' => 2.50, 'stock' => 60, 'unit' => 'L', 'reorder_level' => 8],
            ['name' => 'Cacahuètes grillées', 'cost' => 2.80, 'stock' => 50, 'unit' => 'kg', 'reorder_level' => 6],
            ['name' => 'Amandes effilées', 'cost' => 4.50, 'stock' => 40, 'unit' => 'kg', 'reorder_level' => 5],
            ['name' => 'Noix de cajou', 'cost' => 5.50, 'stock' => 35, 'unit' => 'kg', 'reorder_level' => 5],
            ['name' => 'Pâte à nems', 'cost' => 1.50, 'stock' => 100, 'unit' => 'pcs', 'reorder_level' => 20],
            ['name' => 'Pâte à ravioli', 'cost' => 0.80, 'stock' => 150, 'unit' => 'pcs', 'reorder_level' => 25],
            ['name' => 'Panure croustillante', 'cost' => 1.20, 'stock' => 80, 'unit' => 'kg', 'reorder_level' => 10],
            ['name' => 'Thé vert jasmin', 'cost' => 0.50, 'stock' => 150, 'unit' => 'pcs', 'reorder_level' => 30],
            ['name' => 'Lychee sirop', 'cost' => 2.00, 'stock' => 40, 'unit' => 'L', 'reorder_level' => 6],
            ['name' => 'Soda Mandarine', 'cost' => 0.60, 'stock' => 200, 'unit' => 'pcs', 'reorder_level' => 40],
            ['name' => 'Eau pétillante', 'cost' => 0.20, 'stock' => 300, 'unit' => 'pcs', 'reorder_level' => 50],
            ['name' => 'Banane fraîche', 'cost' => 0.50, 'stock' => 100, 'unit' => 'kg', 'reorder_level' => 15],
            ['name' => 'Pâte de sésame noir', 'cost' => 2.20, 'stock' => 40, 'unit' => 'L', 'reorder_level' => 5],
            ['name' => 'Litchi frais', 'cost' => 3.50, 'stock' => 50, 'unit' => 'kg', 'reorder_level' => 8],
            ['name' => 'Ananas frais', 'cost' => 1.50, 'stock' => 60, 'unit' => 'kg', 'reorder_level' => 8],
        ];

        $ingredientCollection = [];
        foreach ($ingredients as $data) {
            $ingredientCollection[$data['name']] = Ingredient::create($data);
        }

        $categories = [
            ['name' => 'Entrées'],
            ['name' => 'Poulet'],
            ['name' => 'Porc'],
            ['name' => 'Bœuf'],
            ['name' => 'Fruits de Mer'],
            ['name' => 'Légumes'],
            ['name' => 'Riz & Nouilles'],
            ['name' => 'Soupes'],
            ['name' => 'Desserts'],
            ['name' => 'Boissons'],
        ];

        $categoryCollection = [];
        foreach ($categories as $data) {
            $categoryCollection[$data['name']] = Category::create($data);
        }

        $products = [
            // ENTRÉES
            ['category' => 'Entrées', 'name' => 'Nems au poulet (4pcs)', 'desc' => 'Nems croustillants farcis au poulet', 'price' => 6.99, 'ing' => ['Poulet fermier' => 0.15, 'Pâte à nems' => 4, 'Chou chinois' => 0.1, 'Carotte' => 0.08, 'Ail frais' => 0.02]],
            ['category' => 'Entrées', 'name' => 'Ravioli crevettes (x8)', 'desc' => 'Raviolis vapeur aux crevettes', 'price' => 7.99, 'ing' => ['Crevettes fraîches' => 0.2, 'Pâte à ravioli' => 8, 'Bambou frais' => 0.08, 'Oignons verts' => 0.05, 'Gingembre frais' => 0.02]],
            ['category' => 'Entrées', 'name' => 'Calamars frits', 'desc' => 'Calamars croustillants à la sriracha', 'price' => 8.99, 'ing' => ['Crevettes fraîches' => 0.25, 'Panure croustillante' => 0.15, 'Sauce Sriracha' => 0.05, 'Ail frais' => 0.02]],
            ['category' => 'Entrées', 'name' => 'Boulettes porc vapeur', 'desc' => 'Boulettes vapeur porc-gingembre', 'price' => 6.50, 'ing' => ['Porc frais' => 0.2, 'Gingembre frais' => 0.05, 'Œufs fermiers' => 2, 'Oignons verts' => 0.05]],
            // POULET
            ['category' => 'Poulet', 'name' => 'Poulet aux amandes', 'desc' => 'Poulet tendre avec amandes croustillantes', 'price' => 11.99, 'ing' => ['Poulet fermier' => 0.35, 'Amandes effilées' => 0.08, 'Sauce soja' => 0.08, 'Gingembre frais' => 0.03, 'Ail frais' => 0.02, 'Oignons verts' => 0.05]],
            ['category' => 'Poulet', 'name' => 'Poulet au curry rouge', 'desc' => 'Poulet au curry rouge et lait de coco', 'price' => 12.49, 'ing' => ['Poulet fermier' => 0.35, 'Sauce curry rouge' => 0.1, 'Lait de coco' => 0.1, 'Poivron rouge' => 0.1, 'Bambou frais' => 0.08, 'Oignons verts' => 0.05]],
            ['category' => 'Poulet', 'name' => 'Poulet aux noix de cajou', 'desc' => 'Poulet et noix de cajou grillées', 'price' => 13.49, 'ing' => ['Poulet fermier' => 0.35, 'Noix de cajou' => 0.1, 'Sauce huître' => 0.08, 'Poivron jaune' => 0.1, 'Ail frais' => 0.03]],
            ['category' => 'Poulet', 'name' => 'Poulet Manchurien', 'desc' => 'Poulet croustillant en sauce aigre-douce', 'price' => 11.99, 'ing' => ['Poulet fermier' => 0.35, 'Panure croustillante' => 0.1, 'Sauce aigre-douce' => 0.12, 'Gingembre frais' => 0.03, 'Oignons verts' => 0.05]],
            // PORC
            ['category' => 'Porc', 'name' => 'Porc aigre-doux', 'desc' => 'Porc tendre à la sauce aigre-douce', 'price' => 10.99, 'ing' => ['Porc frais' => 0.35, 'Sauce aigre-douce' => 0.12, 'Poivron rouge' => 0.1, 'Carotte' => 0.08, 'Ananas frais' => 0.1]],
            ['category' => 'Porc', 'name' => 'Porc aux légumes', 'desc' => 'Porc sauté avec brocoli et champignons', 'price' => 10.49, 'ing' => ['Porc frais' => 0.35, 'Brocoli frais' => 0.15, 'Champignon de Paris' => 0.12, 'Sauce huître' => 0.08, 'Ail frais' => 0.02]],
            ['category' => 'Porc', 'name' => 'Porc au haricot noir', 'desc' => 'Porc tendre en sauce haricot noir', 'price' => 10.99, 'ing' => ['Porc frais' => 0.35, 'Sauce haricot noir' => 0.1, 'Poivron jaune' => 0.1, 'Gingembre frais' => 0.03, 'Oignons verts' => 0.05]],
            // BŒUF
            ['category' => 'Bœuf', 'name' => 'Bœuf aux brocoli', 'desc' => 'Bœuf tendre avec brocoli croustillant', 'price' => 13.99, 'ing' => ['Bœuf de qualité' => 0.35, 'Brocoli frais' => 0.15, 'Sauce soja' => 0.08, 'Ail frais' => 0.03, 'Gingembre frais' => 0.02]],
            ['category' => 'Bœuf', 'name' => 'Bœuf à l\'orange', 'desc' => 'Bœuf croustillant en sauce à l\'orange', 'price' => 14.49, 'ing' => ['Bœuf de qualité' => 0.35, 'Panure croustillante' => 0.1, 'Sauce aigre-douce' => 0.12, 'Vinaigre riz' => 0.05]],
            ['category' => 'Bœuf', 'name' => 'Bœuf au poivre', 'desc' => 'Bœuf savoureux en sauce poivre noir', 'price' => 14.99, 'ing' => ['Bœuf de qualité' => 0.35, 'Poivron rouge' => 0.12, 'Poivron jaune' => 0.12, 'Sauce soja' => 0.08, 'Ail frais' => 0.03]],
            // FRUITS DE MER
            ['category' => 'Fruits de Mer', 'name' => 'Crevettes à l\'ail', 'desc' => 'Crevettes sautées à l\'ail savoureux', 'price' => 14.99, 'ing' => ['Crevettes fraîches' => 0.4, 'Ail frais' => 0.1, 'Sauce soja' => 0.06, 'Huile sésame' => 0.02, 'Oignons verts' => 0.05]],
            ['category' => 'Fruits de Mer', 'name' => 'Crevettes au curry', 'desc' => 'Crevettes au curry rouge et lait de coco', 'price' => 15.49, 'ing' => ['Crevettes fraîches' => 0.4, 'Sauce curry rouge' => 0.1, 'Lait de coco' => 0.1, 'Poivron rouge' => 0.1, 'Bambou frais' => 0.08]],
            ['category' => 'Fruits de Mer', 'name' => 'Crevettes légumes', 'desc' => 'Crevettes avec brocoli et champignons', 'price' => 14.49, 'ing' => ['Crevettes fraîches' => 0.4, 'Brocoli frais' => 0.12, 'Champignon de Paris' => 0.1, 'Sauce huître' => 0.08, 'Ail frais' => 0.02]],
            // LÉGUMES
            ['category' => 'Légumes', 'name' => 'Tofu aux légumes', 'desc' => 'Tofu avec brocoli et poivrons', 'price' => 8.99, 'ing' => ['Tofu nature' => 0.4, 'Brocoli frais' => 0.15, 'Poivron rouge' => 0.1, 'Champignon de Paris' => 0.1, 'Sauce soja' => 0.06]],
            ['category' => 'Légumes', 'name' => 'Œufs Foo Young', 'desc' => 'Omelette chinoise avec germes de soja', 'price' => 8.49, 'ing' => ['Œufs fermiers' => 3, 'Germes de soja' => 0.12, 'Oignons verts' => 0.08, 'Champignon de Paris' => 0.08, 'Sauce huître' => 0.06]],
            ['category' => 'Légumes', 'name' => 'Légumes sautés', 'desc' => 'Mélange de légumes sautés à la sauce soja', 'price' => 8.49, 'ing' => ['Brocoli frais' => 0.15, 'Carotte' => 0.1, 'Champignon de Paris' => 0.1, 'Poivron jaune' => 0.1, 'Sauce soja' => 0.06]],
            // RIZ & NOUILLES
            ['category' => 'Riz & Nouilles', 'name' => 'Riz frit poulet', 'desc' => 'Riz sauté avec poulet et légumes', 'price' => 9.99, 'ing' => ['Riz basmati' => 0.4, 'Poulet fermier' => 0.2, 'Œufs fermiers' => 2, 'Carotte' => 0.08, 'Oignons verts' => 0.06, 'Sauce soja' => 0.06]],
            ['category' => 'Riz & Nouilles', 'name' => 'Riz frit crevettes', 'desc' => 'Riz sauté aux crevettes et œufs', 'price' => 10.99, 'ing' => ['Riz basmati' => 0.4, 'Crevettes fraîches' => 0.25, 'Œufs fermiers' => 2, 'Carotte' => 0.08, 'Germes de soja' => 0.08, 'Sauce soja' => 0.06]],
            ['category' => 'Riz & Nouilles', 'name' => 'Nouilles sautées œuf', 'desc' => 'Nouilles œuf sautées poulet et légumes', 'price' => 9.49, 'ing' => ['Nouilles œuf' => 0.35, 'Poulet fermier' => 0.2, 'Œufs fermiers' => 1, 'Brocoli frais' => 0.1, 'Sauce soja' => 0.08]],
            ['category' => 'Riz & Nouilles', 'name' => 'Nouilles de riz', 'desc' => 'Nouilles de riz sautées crevettes', 'price' => 10.49, 'ing' => ['Nouilles de riz' => 0.35, 'Crevettes fraîches' => 0.25, 'Poivron rouge' => 0.08, 'Oignons verts' => 0.06, 'Sauce soja' => 0.06]],
            ['category' => 'Riz & Nouilles', 'name' => 'Nouilles croustillantes', 'desc' => 'Nouilles croustillantes sauce soja', 'price' => 9.99, 'ing' => ['Nouilles croustillantes' => 0.3, 'Poulet fermier' => 0.25, 'Champignon de Paris' => 0.1, 'Sauce huître' => 0.08]],
            // SOUPES
            ['category' => 'Soupes', 'name' => 'Soupe aigre-piquante', 'desc' => 'Soupe aigre-piquante avec tofu', 'price' => 5.99, 'ing' => ['Tofu nature' => 0.2, 'Champignon de Paris' => 0.12, 'Vinaigre riz' => 0.08, 'Sauce Sriracha' => 0.05, 'Œufs fermiers' => 1]],
            ['category' => 'Soupes', 'name' => 'Soupe crevettes', 'desc' => 'Soupe crevettes gingembre et citronnelle', 'price' => 6.99, 'ing' => ['Crevettes fraîches' => 0.25, 'Gingembre frais' => 0.05, 'Bambou frais' => 0.08, 'Oignons verts' => 0.06, 'Sauce soja' => 0.04]],
            ['category' => 'Soupes', 'name' => 'Soupe wonton', 'desc' => 'Soupe avec wontons au porc', 'price' => 6.49, 'ing' => ['Porc frais' => 0.15, 'Crevettes fraîches' => 0.15, 'Pâte à ravioli' => 6, 'Oignons verts' => 0.06, 'Sauce soja' => 0.04]],
            // DESSERTS
            ['category' => 'Desserts', 'name' => 'Banane flambée', 'desc' => 'Banane enrobée de sucre caramélisé', 'price' => 5.99, 'ing' => ['Banane fraîche' => 0.3, 'Panure croustillante' => 0.08]],
            ['category' => 'Desserts', 'name' => 'Boule sésame noir', 'desc' => 'Boules souffle sesame noir', 'price' => 5.49, 'ing' => ['Pâte de sésame noir' => 0.08, 'Panure croustillante' => 0.1]],
            ['category' => 'Desserts', 'name' => 'Litchi frais', 'desc' => 'Litchi frais du marché', 'price' => 4.99, 'ing' => ['Litchi frais' => 0.25]],
            // BOISSONS
            ['category' => 'Boissons', 'name' => 'Thé vert jasmin', 'desc' => 'Thé vert jasmin chaud', 'price' => 2.50, 'ing' => ['Thé vert jasmin' => 1]],
            ['category' => 'Boissons', 'name' => 'Nectar lychee', 'desc' => 'Nectar lychee frais et sucré', 'price' => 3.50, 'ing' => ['Lychee sirop' => 0.3]],
            ['category' => 'Boissons', 'name' => 'Soda Mandarine', 'desc' => 'Soda mandarine frais', 'price' => 2.50, 'ing' => ['Soda Mandarine' => 1]],
            ['category' => 'Boissons', 'name' => 'Eau pétillante', 'desc' => 'Eau minérale pétillante', 'price' => 1.99, 'ing' => ['Eau pétillante' => 1]],
        ];

        foreach ($products as $data) {
            $product = Product::create([
                'category_id' => $categoryCollection[$data['category']]->id,
                'designation' => $data['name'],
                'description' => $data['desc'],
                'price' => $data['price'],
                'stock' => 100,
            ]);

            foreach ($data['ing'] as $ingredientName => $quantity) {
                if (isset($ingredientCollection[$ingredientName])) {
                    $product->ingredients()->attach(
                        $ingredientCollection[$ingredientName]->id,
                        ['quantity_needed' => $quantity]
                    );
                }
            }
        }

        echo "✅ Restaurant Chinois 🥡 seeder complété avec 33 plats!";
    }
}
