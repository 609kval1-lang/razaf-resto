<?php

namespace App\Support;

final class Ariary
{
    public static function round(float|int|string|null $amount): float
    {
        return (float) round((float) ($amount ?? 0), 0, PHP_ROUND_HALF_UP);
    }

    public static function lineTotal(float|int|string|null $unitPrice, int|float|string|null $quantity = 1): float
    {
        return self::round($unitPrice) * max(0, (int) ($quantity ?? 0));
    }
}
