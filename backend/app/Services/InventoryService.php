<?php

namespace App\Services;

use App\Models\Ingredient;
use App\Models\RawMaterial;
use Illuminate\Support\Str;
use InvalidArgumentException;

class InventoryService
{
    private const UNIT_MAP = [
        // Mass
        'kg' => ['dimension' => 'mass', 'factor' => 1000.0],
        'kilogramme' => ['dimension' => 'mass', 'factor' => 1000.0],
        'kilogrammes' => ['dimension' => 'mass', 'factor' => 1000.0],
        'g' => ['dimension' => 'mass', 'factor' => 1.0],
        'gr' => ['dimension' => 'mass', 'factor' => 1.0],
        'gramme' => ['dimension' => 'mass', 'factor' => 1.0],
        'grammes' => ['dimension' => 'mass', 'factor' => 1.0],
        'mg' => ['dimension' => 'mass', 'factor' => 0.001],
        // Volume
        'l' => ['dimension' => 'volume', 'factor' => 1000.0],
        'litre' => ['dimension' => 'volume', 'factor' => 1000.0],
        'litres' => ['dimension' => 'volume', 'factor' => 1000.0],
        'ml' => ['dimension' => 'volume', 'factor' => 1.0],
        'cl' => ['dimension' => 'volume', 'factor' => 10.0],
        // Count
        'pcs' => ['dimension' => 'count', 'factor' => 1.0],
        'pc' => ['dimension' => 'count', 'factor' => 1.0],
        'piece' => ['dimension' => 'count', 'factor' => 1.0],
        'pieces' => ['dimension' => 'count', 'factor' => 1.0],
        'pièce' => ['dimension' => 'count', 'factor' => 1.0],
        'pièces' => ['dimension' => 'count', 'factor' => 1.0],
        'unite' => ['dimension' => 'count', 'factor' => 1.0],
        'unites' => ['dimension' => 'count', 'factor' => 1.0],
        'unité' => ['dimension' => 'count', 'factor' => 1.0],
        'unités' => ['dimension' => 'count', 'factor' => 1.0],
        'u' => ['dimension' => 'count', 'factor' => 1.0],
    ];

    public function calculateIngredientMetrics(
        RawMaterial $rawMaterial,
        float $portionSize,
        string $portionUnit
    ): array {
        if ($portionSize <= 0) {
            throw new InvalidArgumentException('La taille de portion doit être supérieure à zéro.');
        }

        $stockInPortionUnit = $this->convert(
            (float) $rawMaterial->stock,
            (string) $rawMaterial->unit,
            $portionUnit
        );

        $quantityAvailable = (int) floor($stockInPortionUnit / $portionSize);
        if ($quantityAvailable < 0) {
            $quantityAvailable = 0;
        }

        $portionInRawUnit = $this->convert(
            $portionSize,
            $portionUnit,
            (string) $rawMaterial->unit
        );

        $costPerPortion = round(((float) $rawMaterial->cost) * $portionInRawUnit, 2);

        return [
            'quantity_available' => $quantityAvailable,
            'cost_per_portion' => $costPerPortion,
            'portion_in_raw_unit' => $portionInRawUnit,
        ];
    }

    public function calculateIngredientRawUsage(Ingredient $ingredient, int $portionCount): float
    {
        if ($portionCount <= 0) {
            return 0.0;
        }

        $rawMaterial = $ingredient->rawMaterial;
        if (!$rawMaterial) {
            throw new InvalidArgumentException("L'ingrédient {$ingredient->name} n'a pas de matière première associée.");
        }

        $portionInRawUnit = $this->convert(
            (float) $ingredient->portion_size,
            (string) $ingredient->portion_unit,
            (string) $rawMaterial->unit
        );

        return $portionInRawUnit * $portionCount;
    }

    public function syncIngredient(Ingredient $ingredient): Ingredient
    {
        $ingredient->loadMissing('rawMaterial');

        if (!$ingredient->rawMaterial) {
            return $ingredient;
        }

        $metrics = $this->calculateIngredientMetrics(
            $ingredient->rawMaterial,
            (float) $ingredient->portion_size,
            (string) $ingredient->portion_unit
        );

        $ingredient->quantity_available = $metrics['quantity_available'];
        $ingredient->cost_per_portion = $metrics['cost_per_portion'];
        $ingredient->save();

        return $ingredient;
    }

    public function syncIngredientsForRawMaterial(RawMaterial $rawMaterial): void
    {
        $rawMaterial->loadMissing('ingredients');

        foreach ($rawMaterial->ingredients as $ingredient) {
            try {
                $this->syncIngredient($ingredient);
            } catch (InvalidArgumentException $exception) {
                // Ne pas bloquer la mise à jour globale du stock si une ancienne donnée est invalide.
            }
        }
    }

    public function convert(float $value, string $fromUnit, string $toUnit): float
    {
        $from = $this->getUnitMeta($fromUnit);
        $to = $this->getUnitMeta($toUnit);

        if ($from['dimension'] !== $to['dimension']) {
            throw new InvalidArgumentException(
                "Unités incompatibles: '{$fromUnit}' et '{$toUnit}'."
            );
        }

        $valueInBase = $value * $from['factor'];

        return $valueInBase / $to['factor'];
    }

    private function getUnitMeta(string $unit): array
    {
        $normalizedUnit = $this->normalizeUnit($unit);

        if (!isset(self::UNIT_MAP[$normalizedUnit])) {
            throw new InvalidArgumentException(
                "Unité non supportée: '{$unit}'. Utilisez des unités comme kg/g, L/ml ou pièce."
            );
        }

        return self::UNIT_MAP[$normalizedUnit];
    }

    private function normalizeUnit(string $unit): string
    {
        $ascii = Str::ascii($unit);
        return Str::lower(trim($ascii));
    }
}
