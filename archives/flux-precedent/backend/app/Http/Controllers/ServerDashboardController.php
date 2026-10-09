<?php

namespace App\Http\Controllers;

use App\Models\Product;
use App\Models\Category;
use Illuminate\Http\Request;

class ServerDashboardController extends Controller
{
    /**
     * Get available products for servers
     */
    public function availableProducts()
    {
        $products = Product::where('stock', '>', 0)
            ->with('category', 'ingredients')
            ->get();

        return response()->json($products);
    }

    /**
     * Get categories with available products
     */
    public function categoriesWithProducts()
    {
        $categories = Category::with([
            'products' => function ($query) {
                $query->where('stock', '>', 0);
            }
        ])->get();

        return response()->json($categories);
    }

    /**
     * Get product details including ingredients
     */
    public function productDetails(Product $product)
    {
        return response()->json(
            $product->load('category', 'ingredients')
        );
    }
}
