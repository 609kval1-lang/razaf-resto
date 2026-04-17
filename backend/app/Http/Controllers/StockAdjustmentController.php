<?php

namespace App\Http\Controllers;

use App\Models\StockAdjustment;
use App\Models\Product;
use App\Models\Ingredient;
use Illuminate\Http\Request;

class StockAdjustmentController extends Controller
{
    /**
     * Récupérer tous les ajustements
     */
    public function index(Request $request)
    {
        $query = StockAdjustment::with(['user']);

        if ($request->has('type')) {
            $query->where('type', $request->type);
        }

        if ($request->has('reason')) {
            $query->where('reason', $request->reason);
        }

        if ($request->has('from_date')) {
            $query->whereDate('created_at', '>=', $request->from_date);
        }

        if ($request->has('to_date')) {
            $query->whereDate('created_at', '<=', $request->to_date);
        }

        $adjustments = $query->orderBy('created_at', 'desc')->paginate(50);

        return response()->json($adjustments);
    }

    /**
     * Créer un ajustement d'ingrédient
     */
    public function adjustIngredient(Request $request, Ingredient $ingredient)
    {
        $validated = $request->validate([
            'quantity' => 'required|numeric',
            'reason' => 'required|in:restock,damage,loss,usage,return,correction',
            'notes' => 'nullable|string',
        ]);

        $oldStock = $ingredient->stock;
        $newStock = $oldStock + $validated['quantity'];

        if ($newStock < 0) {
            return response()->json(['error' => 'Le stock ne peut pas être négatif'], 422);
        }

        // Enregistrer l'ajustement
        $adjustment = StockAdjustment::create([
            'adjustable_type' => Ingredient::class,
            'adjustable_id' => $ingredient->id,
            'user_id' => auth()->id(),
            'type' => 'ingredient',
            'quantity' => $validated['quantity'],
            'reason' => $validated['reason'],
            'notes' => $validated['notes'] ?? null,
            'old_stock' => $oldStock,
            'new_stock' => $newStock,
        ]);

        // Mettre à jour le stock
        $ingredient->update(['stock' => $newStock]);

        return response()->json([
            'message' => 'Ajustement enregistré',
            'adjustment' => $adjustment->load('user'),
            'ingredient' => $ingredient,
        ]);
    }

    /**
     * Créer un ajustement de produit
     */
    public function adjustProduct(Request $request, Product $product)
    {
        $validated = $request->validate([
            'quantity' => 'required|numeric',
            'reason' => 'required|in:restock,damage,loss,usage,return,correction',
            'notes' => 'nullable|string',
        ]);

        $oldStock = $product->stock;
        $newStock = $oldStock + $validated['quantity'];

        if ($newStock < 0) {
            return response()->json(['error' => 'Le stock ne peut pas être négatif'], 422);
        }

        // Enregistrer l'ajustement
        $adjustment = StockAdjustment::create([
            'adjustable_type' => Product::class,
            'adjustable_id' => $product->id,
            'user_id' => auth()->id(),
            'type' => 'product',
            'quantity' => $validated['quantity'],
            'reason' => $validated['reason'],
            'notes' => $validated['notes'] ?? null,
            'old_stock' => $oldStock,
            'new_stock' => $newStock,
        ]);

        // Mettre à jour le stock
        $product->update(['stock' => $newStock]);

        return response()->json([
            'message' => 'Ajustement enregistré',
            'adjustment' => $adjustment->load('user'),
            'product' => $product,
        ]);
    }

    /**
     * Récupérer les ajustements d'un ingrédient
     */
    public function ingredientHistory(Ingredient $ingredient)
    {
        $adjustments = $ingredient->stockAdjustments()
            ->with('user')
            ->orderBy('created_at', 'desc')
            ->paginate(50);

        return response()->json($adjustments);
    }

    /**
     * Récupérer les ajustements d'un produit
     */
    public function productHistory(Product $product)
    {
        $adjustments = $product->stockAdjustments()
            ->with('user')
            ->orderBy('created_at', 'desc')
            ->paginate(50);

        return response()->json($adjustments);
    }

    /**
     * Récupérer les statistiques des ajustements
     */
    public function statistics(Request $request)
    {
        $query = StockAdjustment::query();

        if ($request->has('from_date')) {
            $query->whereDate('created_at', '>=', $request->from_date);
        }

        if ($request->has('to_date')) {
            $query->whereDate('created_at', '<=', $request->to_date);
        }

        $stats = [
            'total' => $query->count(),
            'by_reason' => $query->groupBy('reason')->selectRaw('reason, count(*) as count')->get(),
            'by_type' => $query->groupBy('type')->selectRaw('type, count(*) as count')->get(),
        ];

        return response()->json($stats);
    }
}
