<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        if (!Schema::hasColumn('order_items', 'station')) {
            Schema::table('order_items', function (Blueprint $table) {
                $table->string('station', 20)->default('kitchen')->after('status');
            });
        }

        DB::table('order_items')
            ->join('menus', 'menus.id', '=', 'order_items.menu_id')
            ->select('order_items.id', 'menus.category', 'menus.name')
            ->orderBy('order_items.id')
            ->chunk(200, function ($rows) {
                foreach ($rows as $row) {
                    $station = $this->isBarMenu((string) ($row->category ?? ''), (string) ($row->name ?? ''))
                        ? 'bar'
                        : 'kitchen';

                    DB::table('order_items')
                        ->where('id', $row->id)
                        ->update(['station' => $station]);
                }
            });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (Schema::hasColumn('order_items', 'station')) {
            Schema::table('order_items', function (Blueprint $table) {
                $table->dropColumn('station');
            });
        }
    }

    private function isBarMenu(string $category, string $name): bool
    {
        $source = $this->normalize($category) . ' ' . $this->normalize($name);
        $keywords = [
            'bar',
            'boisson',
            'boissons',
            'drink',
            'beverage',
            'cocktail',
            'mocktail',
            'jus',
            'smoothie',
            'soda',
            'eau',
            'water',
            'cafe',
            'coffee',
            'the',
            'tea',
            'infusion',
            'nectar',
        ];

        foreach ($keywords as $keyword) {
            if ($keyword !== '' && str_contains($source, $keyword)) {
                return true;
            }
        }

        return false;
    }

    private function normalize(string $value): string
    {
        $value = strtolower(trim($value));
        $value = str_replace(['é', 'è', 'ê', 'ë'], 'e', $value);
        $value = str_replace(['à', 'â'], 'a', $value);
        $value = str_replace(['î', 'ï'], 'i', $value);
        $value = str_replace(['ô', 'ö'], 'o', $value);
        $value = str_replace(['û', 'ü', 'ù'], 'u', $value);

        return $value;
    }
};
