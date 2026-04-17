<?php

namespace App\Http\Controllers;

use App\Models\Product;
use App\Models\Category;
use Illuminate\Http\Request;

class ProductController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index()
    {
        $products = Product::with(['category', 'ingredients', 'preparationSteps', 'parentProduct', 'recipes'])->get();
        return response()->json($products);
    }

    /**
     * Show the form for creating a new resource.
     */
    public function create()
    {
        $categories = Category::all();
        return response()->json($categories);
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        // Vérifier que l'utilisateur est autorisé à créer un produit
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

    /**
     * Display the specified resource.
     */
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

    /**
     * Show the form for editing the specified resource.
     */
    public function edit(Product $product)
    {
        $categories = Category::all();
        return response()->json([
            'product' => $product->load('category'),
            'categories' => $categories
        ]);
    }

    /**
     * Update the specified resource in storage.
     */
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


    /**
     * Remove the specified resource from storage.
     */
    public function destroy(Product $product)
    {
        // Vérifier que l'utilisateur est autorisé à supprimer ce produit
        $this->authorize('delete', $product);

        $product->delete();

        return response()->json([
            'message' => 'Produit supprimé avec succès'
        ]);
    }
}
