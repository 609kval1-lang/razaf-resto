<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('categories') || !Schema::hasTable('ingredients')) {
            return;
        }

        $driver = DB::connection()->getDriverName();
        $canToggleForeignKeys = in_array($driver, ['mysql', 'mariadb'], true);

        // Supprimer les anciennes données (garder seulement les chinoises)
        // D'abord les produits et ingrédients associés
        if ($canToggleForeignKeys) {
            DB::statement('SET FOREIGN_KEY_CHECKS=0');
        }

        // Supprimer les catégories non-chinoises et leurs produits
        $oldCategories = ['Pâtes', 'Pizzas', 'Burgers', 'Boissons', 'Desserts'];
        foreach ($oldCategories as $cat) {
            DB::table('categories')->where('name', $cat)->delete();
        }

        // Supprimer les anciens ingrédients
        $oldIngredients = [
            'Pâtes fraîches', 'Sauce Bolognaise', 'Sauce Carbonara', 'Fromage Parmesan',
            'Pâte à pizza', 'Sauce Tomate Pizza', 'Fromage Mozzarella', 'Pepperoni',
            'Buns pour burger', 'Steak haché', 'Laitue', 'Tomate',
            'Coca Cola 33cl', 'Jus Orange', 'Eau Minérale'
        ];

        foreach ($oldIngredients as $ing) {
            DB::table('ingredients')->where('name', $ing)->delete();
        }

        if ($canToggleForeignKeys) {
            DB::statement('SET FOREIGN_KEY_CHECKS=1');
        }
    }

    public function down(): void
    {
        // Rien à faire en rollback
    }
};
