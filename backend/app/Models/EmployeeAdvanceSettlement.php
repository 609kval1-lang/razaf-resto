<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class EmployeeAdvanceSettlement extends Model
{
    protected $fillable = [
        'advance_transaction_id',
        'salary_transaction_id',
        'amount',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
    ];

    public function advanceTransaction()
    {
        return $this->belongsTo(EmployeePayrollTransaction::class, 'advance_transaction_id');
    }

    public function salaryTransaction()
    {
        return $this->belongsTo(EmployeePayrollTransaction::class, 'salary_transaction_id');
    }
}
