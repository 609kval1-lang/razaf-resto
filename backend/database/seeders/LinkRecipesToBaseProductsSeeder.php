<?php

namespace Database\Seeders;

use App\Models\Product;
use Illuminate\Database\Seeder;

class LinkRecipesToBaseProductsSeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        // Mapping: [child_id => parent_id]
        // Nous créons des liens entre les plats et leurs produits de base
        try {
            // Essayer de trouver les produits par leur nom
            $baseProducts = [
                'Poulet' => 1,      // Poulet
                'Porc' => 2,        // Porc
                'Bœuf' => 3,        // Bœuf
                'Crevettes' => 4,   // Crevettes
            ];

            // Plats à lier
            $recipeLinks = [
                // Poulet
                'Poulet au Curry' => 'Poulet',
                'Poulet aux Légumes' => 'Poulet',
                'Poulet à l\'Ail' => 'Poulet',
                'Nouilles avec Poulet' => 'Poulet',
                'Riz Frit Poulet' => 'Poulet',

                // Porc
                'Porc Aigre-Doux' => 'Porc',
                'Porc aux Champignons' => 'Porc',
                'Porc à la Sauce Soja' => 'Porc',
                'Nouilles avec Porc' => 'Porc',
                'Riz Frit Porc' => 'Porc',

                // Bœuf
                'Bœuf aux Oignons' => 'Bœuf',
                'Bœuf à la Sauce d\'Huître' => 'Bœuf',
                'Bœuf aux Légumes' => 'Bœuf',
                'Nouilles avec Bœuf' => 'Bœuf',
                'Riz Frit Bœuf' => 'Bœuf',

                // Crevettes
                'Crevettes à l\'Ail' => 'Crevettes',
                'Crevettes au Gingembre' => 'Crevettes',
                'Crevettes à la Sauce Soja' => 'Crevettes',
                'Nouilles avec Crevettes' => 'Crevettes',
                'Riz Frit Crevettes' => 'Crevettes',
            ];

            // Récupérer tous les produits
            $products = Product::all();

            foreach ($recipeLinks as $recipeName => $baseProductName) {
                // Trouver le produit parent
                $parentProduct = $products->firstWhere('designation', $baseProductName);

                if (!$parentProduct) {
                    $this->command->info("⚠️  Produit de base '$baseProductName' non trouvé");
                    continue;
                }

                // Trouver la recette
                $recipe = $products->firstWhere('designation', $recipeName);

                if (!$recipe) {
                    $this->command->info("⚠️  Recette '$recipeName' non trouvée");
                    continue;
                }

                // Lier la recette au produit parent
                $recipe->update(['parent_product_id' => $parentProduct->id]);
                $this->command->info("✅ $recipeName → $baseProductName (ID: {$parentProduct->id})");
            }

            $this->command->info("\n✅ Liaison des recettes aux produits de base terminée!");
        } catch (\Exception $e) {
            $this->command->error("❌ Erreur: " . $e->getMessage());
        }
    }
}
