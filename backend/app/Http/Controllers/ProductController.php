<?php

namespace App\Http\Controllers;

use App\Models\Product;
use App\Models\Category;
use Illuminate\Http\Request;

class ProductController extends Controller
{
    public function index()
    {
        $products = Product::with(['category', 'ingredients', 'preparationSteps', 'parentProduct', 'recipes'])->get();
        return response()->json($products);
    }

    public function create()
    {
        $categories = Category::all();
        return response()->json($categories);
    }

    public function store(Request $request)
    {
        $this->authorize('create', Product::class);

        $validated = $request->validate([
            'category_id' => 'required|exists:categories,id',
            'parent_product_id' => 'nullable|exists:products,id',
            'designation' => 'required|string|max:255',
            'description' => 'required|string',
            'price' => 'required|numeric|min:0',
            'stock' => 'required|integer|min:0',
        ]);

        $product = Product::create($validated);

        return response()->json([
            'message' => 'Produit créé avec succès',
            'product' => $product->load(['category', 'parentProduct', 'ingredients', 'preparationSteps'])
        ], 201);
    }

    public function show(Product $product)
    {
        return response()->json(
            $product->load([
                'category',
                'ingredients',
                'preparationSteps',
                'parentProduct',
                'recipes'
            ])
        );
    }

    public function edit(Product $product)
    {
        $categories = Category::all();
        return response()->json([
            'product' => $product->load('category'),
            'categories' => $categories
        ]);
    }

public function update(Request $request, Product $product)
{
    $this->authorize('update', $product);

    $validated = $request->validate([
        'category_id' => 'sometimes|required|exists:categories,id',
        'parent_product_id' => 'nullable|exists:products,id',
        'designation' => 'sometimes|required|string|max:255',
        'description' => 'sometimes|required|string',
        'price' => 'sometimes|required|numeric|min:0',
        'stock' => 'sometimes|required|integer|min:0',
    ]);

    $product->update($validated);

    return response()->json([
        'message' => 'Produit mis à jour avec succès',
        'product' => $product->load('category')
    ]);
}


    public function destroy(Product $product)
    {
        $this->authorize('delete', $product);

        $product->delete();

        return response()->json([
            'message' => 'Produit supprimé avec succès'
        ]);
    }
}
