<?php

namespace App\Http\Controllers;

use App\Models\PreparationStep;
use App\Models\Product;
use Illuminate\Http\Request;

class PreparationStepController extends Controller
{
    public function index(Product $product)
    {
        return response()->json(
            $product->preparationSteps()->get()
        );
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'product_id' => 'required|exists:products,id',
            'step_order' => 'required|integer|min:1',
            'instruction' => 'required|string',
            'duration_minutes' => 'nullable|integer|min:0',
            'temperature' => 'nullable|string',
        ]);

        $step = PreparationStep::create($validated);

        return response()->json($step, 201);
    }

    public function show(PreparationStep $preparationStep)
    {
        return response()->json($preparationStep);
    }

    public function update(Request $request, PreparationStep $preparationStep)
    {
        $validated = $request->validate([
            'step_order' => 'nullable|integer|min:1',
            'instruction' => 'nullable|string',
            'duration_minutes' => 'nullable|integer|min:0',
            'temperature' => 'nullable|string',
        ]);

        $preparationStep->update($validated);

        return response()->json($preparationStep);
    }

    public function destroy(PreparationStep $preparationStep)
    {
        $preparationStep->delete();

        return response()->json(['message' => 'Preparation step deleted successfully']);
    }

    public function reorder(Request $request, Product $product)
    {
        $validated = $request->validate([
            'steps' => 'required|array',
            'steps.*.id' => 'required|exists:preparation_steps,id',
            'steps.*.order' => 'required|integer|min:1',
        ]);

        foreach ($validated['steps'] as $stepData) {
            PreparationStep::find($stepData['id'])->update(['step_order' => $stepData['order']]);
        }

        return response()->json(['message' => 'Steps reordered successfully']);
    }
}
