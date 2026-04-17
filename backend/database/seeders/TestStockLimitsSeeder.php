<?php

namespace Database\Seeders;

use App\Models\Ingredient;
use Illuminate\Database\Seeder;

class TestStockLimitsSeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        // Trouver des ingrédients et ajuster leurs stocks pour tester les limites
        echo "\n=== 🧪 TEST DES LIMITES DE STOCK ===\n\n";

        $ingredients = Ingredient::limit(5)->get();

        if ($ingredients->isEmpty()) {
            $this->command->error("❌ Aucun ingrédient trouvé!");
            return;
        }

        $this->command->info("📊 Configuration de test des limites:");
        $this->command->line("");

        foreach ($ingredients as $index => $ing) {
            $minLevel = $ing->reorder_level ?? 100;

            // Test 1: Stock CRITIQUE (0)
            if ($index === 0) {
                $ing->update(['stock' => 0]);
                $this->command->info("✓ Ingrédient 1 ({$ing->name}): Stock = 0 (CRITIQUE - Min: {$minLevel})");
            }
            // Test 2: Stock URGENT (< 50% du minimum)
            else if ($index === 1) {
                $criticalStock = $minLevel * 0.25;
                $ing->update(['stock' => $criticalStock]);
                $this->command->info("✓ Ingrédient 2 ({$ing->name}): Stock = {$criticalStock} (URGENT - Min: {$minLevel})");
            }
            // Test 3: Stock ALERTE (= minimum level)
            else if ($index === 2) {
                $ing->update(['stock' => $minLevel]);
                $this->command->info("✓ Ingrédient 3 ({$ing->name}): Stock = {$minLevel} (ALERTE - Min: {$minLevel})");
            }
            // Test 4: Stock OK (> minimum)
            else if ($index === 3) {
                $okStock = $minLevel * 2;
                $ing->update(['stock' => $okStock]);
                $this->command->info("✓ Ingrédient 4 ({$ing->name}): Stock = {$okStock} (OK - Min: {$minLevel})");
            }
            // Test 5: Très haut stock
            else if ($index === 4) {
                $highStock = $minLevel * 5;
                $ing->update(['stock' => $highStock]);
                $this->command->info("✓ Ingrédient 5 ({$ing->name}): Stock = {$highStock} (OK - Min: {$minLevel})");
            }
        }

        $this->command->line("");
        $this->command->info("✅ Configuration de test terminée!");
        $this->command->line("");
        $this->command->info("📋 PROCÉDURE DE TEST:");
        $this->command->line("1. Allez à: /dashboard/stock/minimum-levels");
        $this->command->line("2. Vous devriez voir:");
        $this->command->line("   - 🚨 Ingrédient 1: CRITIQUE (rouge)");
        $this->command->line("   - ⚠️  Ingrédient 2: URGENT (orange)");
        $this->command->line("   - ⚡ Ingrédient 3: ALERTE (jaune)");
        $this->command->line("   - ✓ Ingrédient 4 & 5: OK (vert)");
        $this->command->line("");
        $this->command->info("🧪 TESTER LES AJUSTEMENTS:");
        $this->command->line("1. Allez à: /dashboard/stock/adjustment");
        $this->command->line("2. Augmentez le stock de l'ingrédient 1 (passez de 0 à 50)");
        $this->command->line("3. Le statut doit passer de CRITIQUE à ALERTE");
        $this->command->line("");
        $this->command->info("📊 VOIR L'HISTORIQUE:");
        $this->command->line("1. Allez à: /dashboard/stock/history");
        $this->command->line("2. Vous verrez tous les ajustements de stock effectués");
        $this->command->line("");
    }
}
