<?php

namespace App\Support;

use App\Models\Menu;

class PreparationStation
{
    public const KITCHEN = 'kitchen';
    public const BAR = 'bar';

    private const BAR_KEYWORDS = [
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

    public static function normalizeStation(?string $station): string
    {
        return strtolower((string) $station) === self::BAR
            ? self::BAR
            : self::KITCHEN;
    }

    public static function stationForMenu(Menu $menu): string
    {
        return self::isBarMenu($menu->category, $menu->name)
            ? self::BAR
            : self::KITCHEN;
    }

    public static function isBarMenu(?string $category, ?string $name): bool
    {
        $source = self::normalize($category) . ' ' . self::normalize($name);

        foreach (self::BAR_KEYWORDS as $keyword) {
            if ($keyword !== '' && str_contains($source, $keyword)) {
                return true;
            }
        }

        return false;
    }

    private static function normalize(?string $value): string
    {
        $normalized = strtolower(trim((string) $value));
        $normalized = str_replace(['é', 'è', 'ê', 'ë'], 'e', $normalized);
        $normalized = str_replace(['à', 'â'], 'a', $normalized);
        $normalized = str_replace(['î', 'ï'], 'i', $normalized);
        $normalized = str_replace(['ô', 'ö'], 'o', $normalized);
        $normalized = str_replace(['û', 'ü', 'ù'], 'u', $normalized);

        return $normalized;
    }
}
