<?php

namespace App\Support;

use Illuminate\Validation\ValidationException;

final class Ariary
{
    public static function requireWhole(float|int|string|null $amount, string $field = 'amount'): float
    {
        $value = (float) ($amount ?? 0);
        if (($amount !== null && !is_numeric($amount)) || !is_finite($value) || floor($value) !== $value) {
            throw ValidationException::withMessages([
                $field => ['Saisissez un montant entier en Ariary, sans decimales.'],
            ]);
        }
        return $value;
    }

    public static function round(float|int|string|null $amount): float
    {
        return (float) round((float) ($amount ?? 0), 0, PHP_ROUND_HALF_UP);
    }

    public static function lineTotal(float|int|string|null $unitPrice, int|float|string|null $quantity = 1): float
    {
        return self::round($unitPrice) * max(0, (int) ($quantity ?? 0));
    }

    public static function allocate(float|int|string|null $amount, array $weights): array
    {
        $total = (int) max(0, self::round($amount));
        $weights = array_map(fn ($weight) => max(0.0, (float) $weight), $weights);
        $weightTotal = array_sum($weights);
        $allocated = array_fill_keys(array_keys($weights), 0);
        if ($weightTotal <= 0 || $total === 0) {
            return $allocated;
        }

        $remainders = [];
        foreach ($weights as $key => $weight) {
            $share = $total * ($weight / $weightTotal);
            $allocated[$key] = (int) floor($share);
            $remainders[$key] = $share - $allocated[$key];
        }

        // Distribute leftover Ariary instead of independently rounding every line.
        arsort($remainders, SORT_NUMERIC);
        $remaining = $total - array_sum($allocated);
        foreach (array_keys($remainders) as $key) {
            if ($remaining <= 0) {
                break;
            }
            $allocated[$key]++;
            $remaining--;
        }

        return $allocated;
    }
}
