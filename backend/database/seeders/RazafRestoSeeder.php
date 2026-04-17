<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;
use App\Models\User;
use App\Models\RawMaterial;
use App\Models\Ingredient;
use App\Models\Menu;
use App\Models\RestaurantTable;
use App\Models\Customer;
use App\Models\Supplier;

class RazafRestoSeeder extends Seeder
{
    public function run(): void
    {
        $this->seedUsers();
        $this->seedTables();
        $this->seedCustomers();

        $rawMaterials = $this->seedRawMaterials();
        $this->seedSuppliers($rawMaterials);
        $ingredients = $this->seedIngredients($rawMaterials);
        $this->seedMenus($ingredients);
    }

    private function seedUsers(): void
    {
        $users = [
            ['name' => 'Admin Razaf', 'email' => 'admin@razaf.com', 'password' => 'admin123', 'role' => 'admin'],
            ['name' => 'Serveur Rahul', 'email' => 'server@razaf.com', 'password' => 'server123', 'role' => 'server'],
            ['name' => 'Cuisine Ahmed', 'email' => 'kitchen@razaf.com', 'password' => 'kitchen123', 'role' => 'kitchen'],
            ['name' => 'Bar Ines', 'email' => 'barman@razaf.com', 'password' => 'barman123', 'role' => 'barman'],
            ['name' => 'Caisse Fatima', 'email' => 'cashier@razaf.com', 'password' => 'cashier123', 'role' => 'cashier'],
        ];

        foreach ($users as $userData) {
            User::updateOrCreate(
                ['email' => $userData['email']],
                [
                    'name' => $userData['name'],
                    'password' => Hash::make($userData['password']),
                    'role' => $userData['role'],
                ]
            );
        }
    }

    private function seedTables(): void
    {
        for ($i = 1; $i <= 12; $i++) {
            RestaurantTable::updateOrCreate(
                ['table_number' => $i],
                [
                    'capacity' => $i <= 4 ? 2 : ($i <= 8 ? 4 : 6),
                    'section' => $i <= 4 ? 'Terrasse' : ($i <= 8 ? 'Intérieur' : 'Salon privé'),
                    'status' => 'free',
                ]
            );
        }
    }

    private function seedCustomers(): void
    {
        $customers = [
            [
                'name' => 'Ahmed Mohamed',
                'phone' => '+261 32 1234567',
                'email' => 'ahmed@email.com',
                'loyalty_points' => 50,
                'notes' => 'Sans piment',
                'preferred_cooking' => 'Bien cuit',
                'allergies' => 'Arachides',
            ],
            [
                'name' => 'Fatima Ali',
                'phone' => '+261 32 7654321',
                'email' => 'fatima@email.com',
                'loyalty_points' => 100,
                'notes' => 'Beaucoup de sauce',
                'preferred_cooking' => 'Moyenne',
                'allergies' => 'Aucune',
            ],
            [
                'name' => 'Rakoto Jean',
                'phone' => '+261 34 8888888',
                'email' => 'rakoto@email.com',
                'loyalty_points' => 25,
                'notes' => 'Préférence table terrasse',
                'preferred_cooking' => 'À point',
                'allergies' => 'Fruits de mer',
            ],
            [
                'name' => 'Volana Ranaivo',
                'phone' => '+261 33 1112222',
                'email' => 'volana@email.com',
                'loyalty_points' => 10,
                'notes' => null,
                'preferred_cooking' => null,
                'allergies' => null,
            ],
        ];

        foreach ($customers as $customerData) {
            Customer::updateOrCreate(
                ['email' => $customerData['email']],
                $customerData
            );
        }
    }

    private function seedRawMaterials(): array
    {
        $rawDefinitions = [
            'riz' => ['name' => 'Riz blanc premium', 'stock' => 220, 'unit' => 'kg', 'cost' => 3200, 'reorder_level' => 25],
            'poulet' => ['name' => 'Poulet fermier', 'stock' => 95, 'unit' => 'kg', 'cost' => 11000, 'reorder_level' => 12],
            'boeuf' => ['name' => 'Boeuf tendre', 'stock' => 70, 'unit' => 'kg', 'cost' => 14500, 'reorder_level' => 10],
            'crevettes' => ['name' => 'Crevettes fraîches', 'stock' => 60, 'unit' => 'kg', 'cost' => 18500, 'reorder_level' => 8],
            'legumes' => ['name' => 'Légumes mixtes', 'stock' => 130, 'unit' => 'kg', 'cost' => 4200, 'reorder_level' => 18],
            'sauce_soja' => ['name' => 'Sauce soja', 'stock' => 80, 'unit' => 'L', 'cost' => 6500, 'reorder_level' => 12],
            'huile' => ['name' => 'Huile parfumée', 'stock' => 55, 'unit' => 'L', 'cost' => 7800, 'reorder_level' => 8],
            'oeufs' => ['name' => 'Oeufs frais', 'stock' => 900, 'unit' => 'pièce', 'cost' => 650, 'reorder_level' => 120],
            'cacahuete' => ['name' => 'Cacahuète grillée', 'stock' => 45, 'unit' => 'kg', 'cost' => 9500, 'reorder_level' => 7],
            'lait_coco' => ['name' => 'Lait de coco', 'stock' => 70, 'unit' => 'L', 'cost' => 8200, 'reorder_level' => 10],
            'vanille' => ['name' => 'Vanille naturelle', 'stock' => 9, 'unit' => 'kg', 'cost' => 92000, 'reorder_level' => 2],
            'banane' => ['name' => 'Banane mûre', 'stock' => 170, 'unit' => 'kg', 'cost' => 2800, 'reorder_level' => 20],
            'manioc' => ['name' => 'Manioc', 'stock' => 160, 'unit' => 'kg', 'cost' => 1900, 'reorder_level' => 18],
            'gingembre' => ['name' => 'Gingembre frais', 'stock' => 26, 'unit' => 'kg', 'cost' => 9000, 'reorder_level' => 4],
            'citron' => ['name' => 'Citron vert', 'stock' => 210, 'unit' => 'pièce', 'cost' => 450, 'reorder_level' => 30],
            'sucre' => ['name' => 'Sucre de canne', 'stock' => 120, 'unit' => 'kg', 'cost' => 2600, 'reorder_level' => 15],
            'cafe' => ['name' => 'Café moulu', 'stock' => 35, 'unit' => 'kg', 'cost' => 17000, 'reorder_level' => 5],
            'eau' => ['name' => 'Eau potable', 'stock' => 650, 'unit' => 'L', 'cost' => 700, 'reorder_level' => 90],
            'menthe' => ['name' => 'Feuilles de menthe', 'stock' => 18, 'unit' => 'kg', 'cost' => 7500, 'reorder_level' => 3],
            'ananas' => ['name' => 'Ananas frais', 'stock' => 90, 'unit' => 'kg', 'cost' => 3500, 'reorder_level' => 12],
        ];

        $rawMaterials = [];

        foreach ($rawDefinitions as $key => $data) {
            $rawMaterials[$key] = RawMaterial::updateOrCreate(
                ['name' => $data['name']],
                [
                    'description' => null,
                    'stock' => $data['stock'],
                    'unit' => $data['unit'],
                    'cost' => $data['cost'],
                    'reorder_level' => $data['reorder_level'],
                ]
            );
        }

        return $rawMaterials;
    }

    private function seedIngredients(array $rawMaterials): array
    {
        $cocktailIngredientKeys = [
            'lait_coco',
            'vanille',
            'banane',
            'gingembre',
            'citron',
            'sucre',
            'cafe',
            'eau',
            'menthe',
            'ananas',
        ];

        $ingredientDefinitions = [
            'riz_blanc' => ['raw' => 'riz', 'name' => 'Riz cuit 250g', 'portion_size' => 250, 'portion_unit' => 'g', 'quantity_available' => 900, 'cost_per_portion' => 800],
            'poulet_grille' => ['raw' => 'poulet', 'name' => 'Poulet grillé 180g', 'portion_size' => 180, 'portion_unit' => 'g', 'quantity_available' => 420, 'cost_per_portion' => 2400],
            'boeuf_saute' => ['raw' => 'boeuf', 'name' => 'Boeuf sauté 180g', 'portion_size' => 180, 'portion_unit' => 'g', 'quantity_available' => 300, 'cost_per_portion' => 3100],
            'crevettes_poelees' => ['raw' => 'crevettes', 'name' => 'Crevettes poêlées 140g', 'portion_size' => 140, 'portion_unit' => 'g', 'quantity_available' => 260, 'cost_per_portion' => 3500],
            'legumes_sautes' => ['raw' => 'legumes', 'name' => 'Légumes sautés 120g', 'portion_size' => 120, 'portion_unit' => 'g', 'quantity_available' => 620, 'cost_per_portion' => 650],
            'sauce_soja' => ['raw' => 'sauce_soja', 'name' => 'Sauce soja 30ml', 'portion_size' => 30, 'portion_unit' => 'ml', 'quantity_available' => 920, 'cost_per_portion' => 250],
            'huile_ail' => ['raw' => 'huile', 'name' => 'Huile parfumée 15ml', 'portion_size' => 15, 'portion_unit' => 'ml', 'quantity_available' => 820, 'cost_per_portion' => 180],
            'oeuf_battu' => ['raw' => 'oeufs', 'name' => 'Oeuf battu 1 unité', 'portion_size' => 1, 'portion_unit' => 'pièce', 'quantity_available' => 900, 'cost_per_portion' => 650],
            'cacahuete' => ['raw' => 'cacahuete', 'name' => 'Cacahuète grillée 25g', 'portion_size' => 25, 'portion_unit' => 'g', 'quantity_available' => 500, 'cost_per_portion' => 420],
            'lait_coco' => ['raw' => 'lait_coco', 'name' => 'Lait de coco 120ml', 'portion_size' => 120, 'portion_unit' => 'ml', 'quantity_available' => 450, 'cost_per_portion' => 980],
            'vanille' => ['raw' => 'vanille', 'name' => 'Vanille 2g', 'portion_size' => 2, 'portion_unit' => 'g', 'quantity_available' => 320, 'cost_per_portion' => 600],
            'banane' => ['raw' => 'banane', 'name' => 'Banane tranchée 130g', 'portion_size' => 130, 'portion_unit' => 'g', 'quantity_available' => 520, 'cost_per_portion' => 360],
            'manioc' => ['raw' => 'manioc', 'name' => 'Manioc frit 200g', 'portion_size' => 200, 'portion_unit' => 'g', 'quantity_available' => 540, 'cost_per_portion' => 420],
            'gingembre' => ['raw' => 'gingembre', 'name' => 'Gingembre 12g', 'portion_size' => 12, 'portion_unit' => 'g', 'quantity_available' => 640, 'cost_per_portion' => 220],
            'citron' => ['raw' => 'citron', 'name' => 'Citron vert 1 unité', 'portion_size' => 1, 'portion_unit' => 'pièce', 'quantity_available' => 980, 'cost_per_portion' => 120],
            'sucre' => ['raw' => 'sucre', 'name' => 'Sucre 20g', 'portion_size' => 20, 'portion_unit' => 'g', 'quantity_available' => 1200, 'cost_per_portion' => 70],
            'cafe' => ['raw' => 'cafe', 'name' => 'Café moulu 10g', 'portion_size' => 10, 'portion_unit' => 'g', 'quantity_available' => 700, 'cost_per_portion' => 280],
            'eau' => ['raw' => 'eau', 'name' => 'Eau 300ml', 'portion_size' => 300, 'portion_unit' => 'ml', 'quantity_available' => 2500, 'cost_per_portion' => 35],
            'menthe' => ['raw' => 'menthe', 'name' => 'Menthe 5g', 'portion_size' => 5, 'portion_unit' => 'g', 'quantity_available' => 480, 'cost_per_portion' => 95],
            'ananas' => ['raw' => 'ananas', 'name' => 'Ananas 160g', 'portion_size' => 160, 'portion_unit' => 'g', 'quantity_available' => 560, 'cost_per_portion' => 520],
        ];

        $ingredients = [];

        foreach ($ingredientDefinitions as $key => $data) {
            $ingredients[$key] = Ingredient::updateOrCreate(
                ['name' => $data['name']],
                [
                    'raw_material_id' => $rawMaterials[$data['raw']]->id,
                    'portion_size' => $data['portion_size'],
                    'portion_unit' => $data['portion_unit'],
                    'quantity_available' => $data['quantity_available'],
                    'cost_per_portion' => $data['cost_per_portion'],
                    'is_cocktail_ingredient' => in_array($key, $cocktailIngredientKeys, true),
                ]
            );
        }

        return $ingredients;
    }

    private function seedSuppliers(array $rawMaterials): void
    {
        $supplierDefinitions = [
            [
                'name' => 'Fresh Agro Supply',
                'email' => 'fresh.agro@suppliers.local',
                'phone' => '+261 34 100 2001',
                'materials' => ['riz', 'legumes', 'banane', 'ananas'],
            ],
            [
                'name' => 'Ocean Prime Foods',
                'email' => 'ocean.prime@suppliers.local',
                'phone' => '+261 34 100 2002',
                'materials' => ['crevettes', 'boeuf', 'poulet'],
            ],
            [
                'name' => 'Bar & Drinks Hub',
                'email' => 'bar.drinks@suppliers.local',
                'phone' => '+261 34 100 2003',
                'materials' => ['eau', 'lait_coco', 'sucre', 'citron', 'menthe'],
            ],
            [
                'name' => 'Spice & Aroma Traders',
                'email' => 'spice.aroma@suppliers.local',
                'phone' => '+261 34 100 2004',
                'materials' => ['gingembre', 'vanille', 'sauce_soja', 'huile', 'cacahuete', 'cafe'],
            ],
            [
                'name' => 'Farm Protein Co',
                'email' => 'farm.protein@suppliers.local',
                'phone' => '+261 34 100 2005',
                'materials' => ['oeufs', 'poulet', 'boeuf'],
            ],
        ];

        foreach ($supplierDefinitions as $definition) {
            $materialIds = collect($definition['materials'])
                ->map(fn ($key) => $rawMaterials[$key]->id ?? null)
                ->filter()
                ->unique()
                ->values();

            if ($materialIds->isEmpty()) {
                continue;
            }

            /** @var Supplier $supplier */
            $supplier = Supplier::updateOrCreate(
                ['email' => $definition['email']],
                [
                    'name' => $definition['name'],
                    'phone' => $definition['phone'],
                    'raw_material_id' => $materialIds->first(),
                ]
            );

            $supplier->rawMaterials()->sync($materialIds->all());
        }
    }

    private function seedMenus(array $ingredients): void
    {
        // Normaliser les anciennes catégories pour garder un dataset cohérent en test.
        Menu::whereIn('category', ['Plats', 'Plat'])->update(['category' => 'main']);
        Menu::whereIn('category', ['Dessert', 'Desserts'])->update(['category' => 'dessert']);
        Menu::whereIn('category', ['Boisson', 'Boissons'])->update(['category' => 'drink']);
        Menu::whereIn('category', ['Entrée', 'Entrées', 'Entree', 'Entrees'])->update(['category' => 'entree']);
        Menu::whereIn('category', ['Accompagnement', 'Accompagnements'])->update(['category' => 'side']);

        $menuDefinitions = [
            [
                'name' => 'Riz Poulet Grillé',
                'description' => 'Riz parfumé, poulet grillé et légumes sautés.',
                'price' => 14000,
                'category' => 'main',
                'image_url' => 'https://loremflickr.com/900/600/grilled,chicken,rice?lock=101',
                'is_available' => true,
                'ingredients' => ['riz_blanc' => 1, 'poulet_grille' => 1, 'legumes_sautes' => 1, 'sauce_soja' => 1],
            ],
            [
                'name' => 'Riz Boeuf Sauté',
                'description' => 'Boeuf tendre sauté au wok avec riz blanc.',
                'price' => 16000,
                'category' => 'main',
                'image_url' => 'https://loremflickr.com/900/600/beef,rice,stirfry?lock=102',
                'is_available' => true,
                'ingredients' => ['riz_blanc' => 1, 'boeuf_saute' => 1, 'legumes_sautes' => 1, 'sauce_soja' => 1, 'huile_ail' => 1],
            ],
            [
                'name' => 'Riz Crevettes Coco',
                'description' => 'Crevettes poêlées, touche coco et citron vert.',
                'price' => 18000,
                'category' => 'main',
                'image_url' => 'https://loremflickr.com/900/600/shrimp,coconut,rice?lock=103',
                'is_available' => true,
                'ingredients' => ['riz_blanc' => 1, 'crevettes_poelees' => 1, 'lait_coco' => 1, 'gingembre' => 1, 'citron' => 1],
            ],
            [
                'name' => 'Poulet Coco Vanille',
                'description' => 'Poulet fondant au lait de coco et vanille.',
                'price' => 17000,
                'category' => 'main',
                'image_url' => 'https://loremflickr.com/900/600/coconut,chicken,dish?lock=104',
                'is_available' => true,
                'ingredients' => ['poulet_grille' => 1, 'lait_coco' => 1, 'vanille' => 1, 'riz_blanc' => 1],
            ],
            [
                'name' => 'Riz Cantonnais Maison',
                'description' => 'Riz sauté maison avec oeuf et légumes.',
                'price' => 15000,
                'category' => 'main',
                'image_url' => 'https://loremflickr.com/900/600/fried,rice,egg?lock=105',
                'is_available' => true,
                'ingredients' => ['riz_blanc' => 1, 'oeuf_battu' => 1, 'legumes_sautes' => 1, 'sauce_soja' => 1],
            ],
            [
                'name' => 'Manioc Frit et Poulet',
                'description' => 'Manioc croustillant et morceaux de poulet grillé.',
                'price' => 13000,
                'category' => 'main',
                'image_url' => 'https://loremflickr.com/900/600/cassava,chicken,fries?lock=106',
                'is_available' => true,
                'ingredients' => ['manioc' => 2, 'poulet_grille' => 1, 'huile_ail' => 1],
            ],
            [
                'name' => 'Bol Veggie Tropical',
                'description' => 'Riz, légumes, ananas et citron vert.',
                'price' => 14500,
                'category' => 'main',
                'image_url' => 'https://loremflickr.com/900/600/veggie,bowl,tropical?lock=107',
                'is_available' => true,
                'ingredients' => ['riz_blanc' => 1, 'legumes_sautes' => 2, 'ananas' => 1, 'citron' => 1],
            ],
            [
                'name' => 'Brochettes Boeuf Gingembre',
                'description' => 'Brochettes de boeuf marinées au gingembre.',
                'price' => 16500,
                'category' => 'main',
                'image_url' => 'https://loremflickr.com/900/600/beef,skewer,ginger?lock=108',
                'is_available' => true,
                'ingredients' => ['boeuf_saute' => 1, 'gingembre' => 1, 'sauce_soja' => 1, 'riz_blanc' => 1],
            ],
            [
                'name' => 'Crevettes Sauce Ail',
                'description' => 'Crevettes sautées à l’ail servies sur riz.',
                'price' => 19000,
                'category' => 'main',
                'image_url' => 'https://loremflickr.com/900/600/garlic,shrimp,plate?lock=109',
                'is_available' => true,
                'ingredients' => ['crevettes_poelees' => 2, 'huile_ail' => 1, 'riz_blanc' => 1],
            ],
            [
                'name' => 'Riz Cacahuète Poulet',
                'description' => 'Riz poulet à la sauce cacahuète maison.',
                'price' => 15500,
                'category' => 'main',
                'image_url' => 'https://loremflickr.com/900/600/peanut,chicken,rice?lock=110',
                'is_available' => true,
                'ingredients' => ['riz_blanc' => 1, 'poulet_grille' => 1, 'cacahuete' => 1, 'sauce_soja' => 1],
            ],
            [
                'name' => 'Salade Croquante Citron',
                'description' => 'Entrée fraîche de légumes sautés, citron et huile parfumée.',
                'price' => 6000,
                'category' => 'entree',
                'image_url' => 'https://loremflickr.com/900/600/salad,lemon,starter?lock=210',
                'is_available' => true,
                'ingredients' => ['legumes_sautes' => 1, 'citron' => 1, 'huile_ail' => 1],
            ],
            [
                'name' => 'Soupe Coco Gingembre',
                'description' => 'Entrée chaude à base de lait de coco et gingembre.',
                'price' => 6500,
                'category' => 'entree',
                'image_url' => 'https://loremflickr.com/900/600/soup,coconut,ginger?lock=211',
                'is_available' => true,
                'ingredients' => ['lait_coco' => 1, 'gingembre' => 1, 'eau' => 1],
            ],
            [
                'name' => 'Mini Wrap Poulet',
                'description' => 'Snack rapide au poulet grillé et légumes.',
                'price' => 8000,
                'category' => 'snack',
                'image_url' => 'https://loremflickr.com/900/600/chicken,wrap,snack?lock=212',
                'is_available' => true,
                'ingredients' => ['poulet_grille' => 1, 'legumes_sautes' => 1, 'sauce_soja' => 1],
            ],
            [
                'name' => 'Croquettes Manioc',
                'description' => 'Snack croustillant à base de manioc frit.',
                'price' => 5500,
                'category' => 'snack',
                'image_url' => 'https://loremflickr.com/900/600/cassava,snack,croquette?lock=213',
                'is_available' => true,
                'ingredients' => ['manioc' => 1, 'huile_ail' => 1],
            ],
            [
                'name' => 'Riz Blanc Portion',
                'description' => 'Accompagnement simple de riz blanc cuit.',
                'price' => 3500,
                'category' => 'side',
                'image_url' => 'https://loremflickr.com/900/600/rice,side,dish?lock=214',
                'is_available' => true,
                'ingredients' => ['riz_blanc' => 1],
            ],
            [
                'name' => 'Légumes Sautés Portion',
                'description' => 'Accompagnement de légumes sautés minute.',
                'price' => 4000,
                'category' => 'side',
                'image_url' => 'https://loremflickr.com/900/600/vegetables,side,dish?lock=215',
                'is_available' => true,
                'ingredients' => ['legumes_sautes' => 1],
            ],
            [
                'name' => 'Banane Caramélisée',
                'description' => 'Dessert chaud banane, sucre et vanille.',
                'price' => 7000,
                'category' => 'dessert',
                'image_url' => 'https://loremflickr.com/900/600/caramelized,banana,dessert?lock=111',
                'is_available' => true,
                'ingredients' => ['banane' => 2, 'sucre' => 1, 'vanille' => 1],
            ],
            [
                'name' => 'Coco Manioc Doux',
                'description' => 'Manioc doux au lait de coco et sucre de canne.',
                'price' => 6500,
                'category' => 'dessert',
                'image_url' => 'https://loremflickr.com/900/600/coconut,dessert,bowl?lock=112',
                'is_available' => true,
                'ingredients' => ['manioc' => 1, 'lait_coco' => 1, 'sucre' => 1],
            ],
            [
                'name' => 'Jus d\'Ananas Frais',
                'description' => 'Boisson fraîche ananas pressé.',
                'price' => 5000,
                'category' => 'drink',
                'image_url' => 'https://loremflickr.com/900/600/pineapple,juice,drink?lock=113',
                'is_available' => true,
                'ingredients' => ['ananas' => 2, 'eau' => 1, 'sucre' => 1],
            ],
            [
                'name' => 'Citronnade Maison',
                'description' => 'Citron vert, menthe et sucre de canne.',
                'price' => 4500,
                'category' => 'drink',
                'image_url' => 'https://loremflickr.com/900/600/lemonade,mint,drink?lock=114',
                'is_available' => true,
                'ingredients' => ['citron' => 2, 'eau' => 1, 'sucre' => 1, 'menthe' => 1],
            ],
            [
                'name' => 'Thé Gingembre',
                'description' => 'Infusion chaude au gingembre.',
                'price' => 4000,
                'category' => 'drink',
                'image_url' => 'https://loremflickr.com/900/600/ginger,tea,cup?lock=115',
                'is_available' => true,
                'ingredients' => ['gingembre' => 1, 'eau' => 1, 'sucre' => 1],
            ],
            [
                'name' => 'Café Noir',
                'description' => 'Café noir intense, service chaud.',
                'price' => 3500,
                'category' => 'drink',
                'image_url' => 'https://loremflickr.com/900/600/black,coffee,cup?lock=116',
                'is_available' => true,
                'ingredients' => ['cafe' => 1, 'eau' => 1],
            ],
            [
                'name' => 'Eau Minérale',
                'description' => 'Bouteille d’eau fraîche 50cl.',
                'price' => 2000,
                'category' => 'drink',
                'image_url' => 'https://loremflickr.com/900/600/water,bottle,drink?lock=117',
                'is_available' => true,
                'ingredients' => ['eau' => 1],
            ],
            [
                'name' => 'Smoothie Banane Vanille',
                'description' => 'Smoothie onctueux banane et vanille.',
                'price' => 6000,
                'category' => 'drink',
                'image_url' => 'https://loremflickr.com/900/600/banana,smoothie,drink?lock=118',
                'is_available' => true,
                'ingredients' => ['banane' => 2, 'lait_coco' => 1, 'vanille' => 1, 'sucre' => 1],
            ],
        ];

        foreach ($menuDefinitions as $menuData) {
            $menu = Menu::updateOrCreate(
                ['name' => $menuData['name']],
                [
                    'description' => $menuData['description'],
                    'price' => $menuData['price'],
                    'category' => $menuData['category'],
                    'image_url' => $menuData['image_url'],
                    'is_available' => $menuData['is_available'],
                ]
            );

            $syncPayload = [];
            foreach ($menuData['ingredients'] as $ingredientKey => $quantityNeeded) {
                $syncPayload[$ingredients[$ingredientKey]->id] = ['quantity_needed' => (int) $quantityNeeded];
            }

            $menu->ingredients()->sync($syncPayload);
        }
    }
}
