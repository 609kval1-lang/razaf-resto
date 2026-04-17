<?php

namespace App\Http\Controllers;

use App\Models\Ingredient;
use Illuminate\Http\Request;

class IngredientController extends Controller
{
    public function index()
    {
        $ingredients = Ingredient::all();
        return response()->json($ingredients);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255', 'unique:ingredients'],
            'description' => ['nullable', 'string'],
            'cost' => ['required', 'numeric', 'min:0'],
            'stock' => ['required', 'numeric', 'min:0'],
            'unit' => ['required', 'in:unit,kg,L,pcs,g,ml'],
            'reorder_level' => ['required', 'numeric', 'min:0'],
        ]);

        $ingredient = Ingredient::create($validated);

        return response()->json([
            'message' => 'Ingrédient créé avec succès',
            'ingredient' => $ingredient,
        ], 201);
    }

    public function show(Ingredient $ingredient)
    {
        return response()->json($ingredient->load('products'));
    }

    public function update(Request $request, Ingredient $ingredient)
    {
        $validated = $request->validate([
            'name' => ['sometimes', 'string', 'max:255', 'unique:ingredients,name,' . $ingredient->id],
            'description' => ['nullable', 'string'],
            'cost' => ['sometimes', 'numeric', 'min:0'],
            'stock' => ['sometimes', 'numeric', 'min:0'],
            'unit' => ['sometimes', 'in:unit,kg,L,pcs,g,ml'],
            'reorder_level' => ['sometimes', 'numeric', 'min:0'],
        ]);

        $ingredient->update($validated);

        return response()->json([
            'message' => 'Ingrédient mis à jour',
            'ingredient' => $ingredient,
        ]);
    }

    public function destroy(Ingredient $ingredient)
    {
        $ingredient->delete();

        return response()->json([
            'message' => 'Ingrédient supprimé',
        ]);
    }

    /**
     * Get low stock ingredients
     */
    public function lowStock()
    {
        $ingredients = Ingredient::whereRaw('stock <= reorder_level')->get();
        return response()->json($ingredients);
    }
}
