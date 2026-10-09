<?php

namespace App\Services;

use App\Models\Payment;
use App\Support\Ariary;

class SalesBreakdownService
{
    public function summarize($payments): array
    {
        $totals = ['restaurant' => 0.0, 'boissons' => 0.0, 'cocktails' => 0.0];
        $dashboardWeights = ['drinks' => 0.0, 'dishes' => 0.0];

        foreach ($payments as $payment) {
            $order = $payment->order;
            $unroundedNet = max(0.0, (float) $payment->amount);
            if (!$order) {
                $dashboardWeights['dishes'] += $unroundedNet;
                continue;
            }

            $net = max(0.0, Ariary::round($payment->amount));
            $weights = $order->items->mapWithKeys(fn ($item) => [
                $item->id => Ariary::lineTotal($item->price_at_order, $item->quantity),
            ])->all();
            $weights['packaging'] = $order->with_packaging
                ? Ariary::lineTotal($order->packaging_unit_price, $order->packaging_quantity)
                : 0;
            $allocated = Ariary::allocate($net, $weights);
            $weightTotal = array_sum($weights);
            $dashboardWeights['dishes'] += $weightTotal > 0
                ? $unroundedNet * ($weights['packaging'] / $weightTotal)
                : $unroundedNet;

            foreach ($order->items as $item) {
                $bucket = $this->salesBucket(
                    (string) ($item->menu?->category ?? ''),
                    (string) ($item->menu?->name ?? ''),
                    (string) ($item->station ?? '')
                );
                $totals[$bucket] += $allocated[$item->id] ?? 0;
                if ($weightTotal > 0) {
                    $dashboardWeights[$bucket === 'restaurant' ? 'dishes' : 'drinks'] +=
                        $unroundedNet * ($weights[$item->id] / $weightTotal);
                }
            }
        }

        return [
            'sales_breakdown' => [
                'restaurant' => Ariary::round($totals['restaurant']),
                'boissons' => Ariary::round($totals['boissons']),
                'cocktails' => Ariary::round($totals['cocktails']),
                'total' => Ariary::round(array_sum($totals)),
            ],
            'dashboard_sales' => Ariary::allocate($payments->sum('amount'), $dashboardWeights),
        ];
    }

    private function salesBucket(string $category, string $name, string $station): string
    {
        $normalizedCategory = $this->normalize($category);
        $normalizedName = $this->normalize($name);
        $normalizedStation = $this->normalize($station);

        $matches = fn (string $source, array $keywords) => preg_match(
            '/(?:^|[^a-z0-9])(?:'.implode('|', array_map(fn ($word) => preg_quote($word, '/'), $keywords)).')(?:$|[^a-z0-9])/',
            $source
        ) === 1;

        if ($matches($normalizedCategory, ['cocktail', 'cocktails', 'mocktail', 'mocktails'])) return 'cocktails';
        if ($matches($normalizedCategory, ['boisson', 'boissons', 'drink', 'drinks', 'beverage', 'beverages', 'bar'])) return 'boissons';
        if ($matches($normalizedCategory, ['main', 'plat', 'plats', 'entree', 'entrees', 'starter', 'dessert', 'desserts',
            'snack', 'snacks', 'side', 'accompagnement', 'accompagnements'])) return 'restaurant';

        $source = trim($normalizedCategory . ' ' . $normalizedName);
        foreach (['cocktail', 'mocktail'] as $keyword) {
            if ($matches($source, [$keyword, $keyword.'s'])) return 'cocktails';
        }
        foreach ([
            'bar', 'boisson', 'boissons', 'drink', 'beverage', 'jus', 'smoothie', 'soda', 'eau', 'water',
            'cafe', 'coffee', 'the', 'tea', 'infusion', 'nectar', 'biere', 'beer', 'vin', 'wine',
            'whisky', 'rhum', 'vodka', 'gin',
        ] as $keyword) {
            if ($matches($source, [$keyword])) return 'boissons';
        }

        return $normalizedStation === 'bar' ? 'boissons' : 'restaurant';
    }

    private function normalize(string $value): string
    {
        $value = strtolower(trim($value));
        return strtr($value, [
            'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e',
            'à' => 'a', 'â' => 'a', 'î' => 'i', 'ï' => 'i',
            'ô' => 'o', 'ö' => 'o', 'ù' => 'u', 'û' => 'u', 'ü' => 'u',
        ]);
    }
}
